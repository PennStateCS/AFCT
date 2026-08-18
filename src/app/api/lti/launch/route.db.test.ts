import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { stateCookieName } from '@/lib/lti/login-init';
import { startLaunch } from '@/lib/lti/launch-transaction';

/**
 * Receiving a launch, against a real Postgres.
 *
 * Token verification is proved in `launch.db.test.ts`, so it is stubbed here. What this covers
 * is the state check, which is the only defence against somebody completing their own launch in
 * another person's browser.
 */

const validateLaunch = vi.hoisted(() => vi.fn());
const resolveLaunchSignIn = vi.hoisted(() => vi.fn());
vi.mock('@/lib/lti/launch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/lti/launch')>()),
  validateLaunch,
}));
vi.mock('@/lib/lti/lti-signin', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/lti/lti-signin')>()),
  resolveLaunchSignIn,
}));

const { POST } = await import('./route');

const USER_ID = 'u-ltilaunch';

const identity = {
  platformId: 'ltip-1',
  // A launch normally carries the course it came from.
  issuer: 'https://canvas.example.test',
  subject: 'lms-user-1',
  email: 'student@example.test',
  firstName: 'Ada',
  lastName: 'Lovelace',
  roles: [],
  contextId: 'ctx-1',
  contextTitle: 'Theory of Computation',
  assignmentId: null,
  resourceLinkId: null,
  targetLinkUri: null,
};

/** Post a launch, with whatever cookie a test wants to send. */
function post(opts: { state?: string; cookieState?: string; idToken?: string }) {
  const body = new FormData();
  if (opts.idToken !== undefined) body.append('id_token', opts.idToken);
  if (opts.state !== undefined) body.append('state', opts.state);

  return POST(
    new Request('https://afct.example.test/api/lti/launch', {
      method: 'POST',
      body,
      // Named from the state, so two launches at once do not share one cookie.
      headers: opts.cookieState
        ? { cookie: `${stateCookieName(opts.state ?? opts.cookieState)}=${opts.cookieState}` }
        : undefined,
    }),
  );
}

async function destroyFixtures() {
  await prisma.activityLog.deleteMany({ where: { action: 'LTI_LAUNCH_DENIED' } });
  await prisma.ltiLineItem.deleteMany({});
  await prisma.ltiPendingLink.deleteMany({});
  await prisma.ltiContextLink.deleteMany({});
  await prisma.roster.deleteMany({ where: { courseId: 'c-launch-dest' } });
  await prisma.assignment.deleteMany({
    where: { courseId: { in: ['c-launch-dest', 'c-elsewhere'] } },
  });
  await prisma.course.deleteMany({ where: { id: { in: ['c-launch-dest', 'c-elsewhere'] } } });
  await prisma.ltiPlatform.deleteMany({ where: { id: 'ltip-1' } });
  await prisma.singleUseToken.deleteMany({
    where: { purpose: 'LTI_SESSION_TICKET' },
  });
  await prisma.user.deleteMany({ where: { id: USER_ID } });
  // The administrators these tests create, and the confirmations waiting on them. Left behind,
  // they collided with their own unique email the next time the suite ran.
  await prisma.ltiPendingIdentityLink.deleteMany({});
  await prisma.user.deleteMany({ where: { email: { endsWith: '@example.edu' } } });
}

/**
 * A launch that is going to work: a state, a cookie that matches, and a token that verifies.
 * `validateLaunch` is mocked here, so the launch record it would read lives in its own suite.
 */
async function goodLaunch() {
  const state = `state-${Math.random().toString(36).slice(2)}`;
  return { state, cookieState: state, idToken: 'a-token' };
}

beforeEach(async () => {
  vi.clearAllMocks();
  await destroyFixtures();
  await prisma.user.create({
    data: { id: USER_ID, email: 'student@example.test', password: null },
  });
  validateLaunch.mockResolvedValue({ ok: true, identity });
  resolveLaunchSignIn.mockResolvedValue({ ok: true, userId: USER_ID, created: false });
});

afterAll(async () => {
  await destroyFixtures();
  await prisma.$disconnect();
});

/**
 * Where a verified launch sends the person. Decided in the endpoint, because it is the last
 * point that still holds the verified launch: everything after is a browser following a link.
 */
const COURSE = 'c-launch-dest';
const PLATFORM_ID = 'ltip-1';

const withCourse = async () => {
  await prisma.ltiPlatform.create({
    data: {
      id: PLATFORM_ID,
      name: 'Test Canvas',
      issuer: 'https://canvas.example.test',
      clientId: 'c1',
      deploymentId: 'd1',
      authLoginUrl: 'https://canvas.example.test/auth',
      tokenUrl: 'https://canvas.example.test/token',
      keysetUrl: 'https://canvas.example.test/jwks',
    },
  });
  await prisma.course.create({
    data: {
      id: COURSE,
      name: 'Theory of Computation',
      code: 'CMPSC 464',
      semester: 'Fall 2026',
      credits: 3,
      startDate: new Date('2026-08-24T00:00:00Z'),
      endDate: new Date('2026-12-18T00:00:00Z'),
    },
  });
};

describe('where a launch lands', () => {
  const nextOf = (res: Response) => new URL(res.headers.get('location')!).searchParams.get('next');

  it('goes to the course when the LMS course is linked', async () => {
    await withCourse();
    await prisma.ltiContextLink.create({
      data: { platformId: PLATFORM_ID, contextId: 'ctx-1', courseId: COURSE },
    });

    const res = await post(await goodLaunch());

    expect(nextOf(res)).toBe(`/dashboard/courses/${COURSE}`);
  });

  /**
   * A deep link names the assignment it was made for, so it opens there rather than at the
   * course. The path is the one the course page links to; an invented one would 404 and look
   * like a broken launch.
   */
  it('opens the assignment a deep link names', async () => {
    await withCourse();
    await prisma.ltiContextLink.create({
      data: { platformId: PLATFORM_ID, contextId: 'ctx-1', courseId: COURSE },
    });
    await prisma.assignment.create({
      data: { id: 'a-deep', courseId: COURSE, title: 'Linked', dueDate: new Date() },
    });
    validateLaunch.mockResolvedValue({
      ok: true,
      identity: { ...identity, assignmentId: 'a-deep' },
    });

    const res = await post(await goodLaunch());

    expect(nextOf(res)).toBe(`/dashboard/courses/${COURSE}/a-deep`);
  });

  /**
   * The claim travels through the platform, so it could name an assignment in another course.
   * Landing somebody there would be a way to read work they should not see.
   */
  it('ignores an assignment that belongs to a different course', async () => {
    await withCourse();
    await prisma.ltiContextLink.create({
      data: { platformId: PLATFORM_ID, contextId: 'ctx-1', courseId: COURSE },
    });
    // A real assignment, in a course this launch has nothing to do with. It has to exist, or
    // the lookup returns nothing whether the course is checked or not and the test proves
    // nothing.
    await prisma.course.create({
      data: {
        id: 'c-elsewhere',
        name: 'Another course',
        code: 'CMPSC 999',
        semester: 'Fall 2026',
        credits: 3,
        startDate: new Date('2026-08-24T00:00:00Z'),
        endDate: new Date('2026-12-18T00:00:00Z'),
      },
    });
    await prisma.assignment.create({
      data: { id: 'a-elsewhere', courseId: 'c-elsewhere', title: 'Not yours', dueDate: new Date() },
    });
    validateLaunch.mockResolvedValue({
      ok: true,
      identity: { ...identity, assignmentId: 'a-elsewhere' },
    });

    const res = await post(await goodLaunch());

    expect(nextOf(res)).toBe(`/dashboard/courses/${COURSE}`);
  });

  it('enrols the person on the way in', async () => {
    await withCourse();
    await prisma.ltiContextLink.create({
      data: { platformId: PLATFORM_ID, contextId: 'ctx-1', courseId: COURSE },
    });

    await post(await goodLaunch());

    const row = await prisma.roster.findFirstOrThrow({
      where: { courseId: COURSE, userId: USER_ID },
    });
    expect(row.role).toBe('STUDENT');
  });

  /**
   * A student cannot fix an unlinked course and must not be asked to. Faculty get the picker,
   * which is covered where the rule lives.
   */
  it('tells somebody who cannot link that it is not ready', async () => {
    await withCourse();

    const res = await post(await goodLaunch());

    expect(nextOf(res)).toBe('/lti/link?notReady=1');
    expect(await prisma.ltiPendingLink.count()).toBe(0);
  });

  /**
   * The column the platform names for itself.
   *
   * AGS sends `lineitem` beside `lineitems` on a resource link launch once the platform has bound
   * a column to that link. Taking it means sending a grade needs no search: no dependence on the
   * platform honouring a `resource_id` filter, and no way to adopt the wrong column, which is how
   * a grade once landed on a second assignment of the same name.
   */
  describe('the gradebook column a launch names', () => {
    const NAMED_URL = 'https://canvas.example.test/api/lti/courses/1/line_items/7';

    const linked = async () => {
      await withCourse();
      await prisma.ltiContextLink.create({
        data: { platformId: PLATFORM_ID, contextId: 'ctx-1', courseId: COURSE },
      });
    };

    it('is recorded against the assignment the link opens', async () => {
      await linked();
      const assignment = await prisma.assignment.create({
        data: { id: 'a-named', courseId: COURSE, title: 'Named', dueDate: new Date() },
        select: { id: true },
      });
      validateLaunch.mockResolvedValue({
        ok: true,
        identity: { ...identity, assignmentId: assignment.id, lineItemUrl: NAMED_URL },
      });

      await post(await goodLaunch());

      const stored = await prisma.ltiLineItem.findFirst({
        where: { assignmentId: assignment.id },
        select: { url: true, label: true, scoreMaximum: true },
      });
      expect(stored?.url).toBe(NAMED_URL);
      // Left unset on purpose: those record what the column was last *told* it is called and
      // worth, and naming a URL says nothing about either.
      expect(stored?.label).toBeNull();
      expect(stored?.scoreMaximum).toBeNull();
    });

    it('ignores an assignment that is not in the course the link opens', async () => {
      // The id arrives in a custom claim, which travels through the platform and could name an
      // assignment anywhere. Writing it would point this LMS course at another course's grades.
      await linked();
      await prisma.course.create({
        data: {
          id: 'c-elsewhere',
          name: 'Elsewhere',
          code: 'X 1',
          semester: 'Fall 2026',
          credits: 3,
          startDate: new Date('2026-08-24T00:00:00Z'),
          endDate: new Date('2026-12-18T00:00:00Z'),
        },
      });
      await prisma.assignment.create({
        data: {
          id: 'a-elsewhere-2',
          courseId: 'c-elsewhere',
          title: 'Elsewhere',
          dueDate: new Date(),
        },
      });
      validateLaunch.mockResolvedValue({
        ok: true,
        identity: { ...identity, assignmentId: 'a-elsewhere-2', lineItemUrl: NAMED_URL },
      });

      await post(await goodLaunch());

      expect(await prisma.ltiLineItem.count()).toBe(0);
    });

    it('records nothing when the platform named no column', async () => {
      // A course-level launch with no resource link, and every platform that does not send it.
      await linked();

      await post(await goodLaunch());

      expect(await prisma.ltiLineItem.count()).toBe(0);
    });
  });
});

describe('a launch that works', () => {
  it('sends the browser on with a ticket to spend', async () => {
    const res = await post(await goodLaunch());

    expect(res.status).toBe(303);
    const location = new URL(res.headers.get('location')!);
    expect(location.pathname).toBe('/lti/complete');
    expect(location.searchParams.get('ticket')).toBeTruthy();
  });

  it('issues the ticket for the person the launch resolved to', async () => {
    await post(await goodLaunch());

    const ticket = await prisma.singleUseToken.findFirstOrThrow({
      where: { purpose: 'LTI_SESSION_TICKET' },
    });
    expect(ticket.userId).toBe(USER_ID);
  });

  // A minute is plenty to redirect and sign in, and short enough to be useless if it leaks.
  it('gives the ticket a short life', async () => {
    await post(await goodLaunch());

    const ticket = await prisma.singleUseToken.findFirstOrThrow({
      where: { purpose: 'LTI_SESSION_TICKET' },
    });
    expect(ticket.expiresAt.getTime() - ticket.createdAt.getTime()).toBeLessThanOrEqual(61_000);
  });

  it('clears the state cookie behind it', async () => {
    const res = await post(await goodLaunch());

    expect(res.headers.get('set-cookie') ?? '').toContain('afct.lti.state.');
  });
});

/**
 * The state check. Its whole job is stopping somebody starting a launch as themselves and
 * getting a victim's browser to finish it, which would sign the victim in as the attacker. The
 * nonce cannot catch that: such a launch is fresh, not replayed.
 */
describe('the state check', () => {
  it('refuses a launch whose cookie does not match', async () => {
    const launch = await goodLaunch();

    const res = await post({ ...launch, cookieState: 'a-different-browsers-state' });

    expect(res.status).toBe(400);
    expect(await prisma.singleUseToken.count({ where: { purpose: 'LTI_SESSION_TICKET' } })).toBe(0);
  });

  it('refuses a launch carrying no cookie at all', async () => {
    const launch = await goodLaunch();

    const res = await post({ state: launch.state, idToken: launch.idToken });

    expect(res.status).toBe(400);
    expect(validateLaunch).not.toHaveBeenCalled();
  });

  /**
   * Whether the state names a launch AFCT started, and whether that launch has been spent, are
   * decided in `validateLaunch` against the launch record. The endpoint's job is to prove the
   * browser is the one that started it, and to hand both values over.
   */
  it('gives the state to the launch check along with the token', async () => {
    const launch = await goodLaunch();

    await post(launch);

    expect(validateLaunch).toHaveBeenCalledWith({
      idToken: launch.idToken,
      state: launch.state,
    });
  });

  it('refuses a launch missing its token', async () => {
    const launch = await goodLaunch();

    const res = await post({ state: launch.state, cookieState: launch.cookieState });

    expect(res.status).toBe(400);
  });
});

describe('a launch that does not verify', () => {
  it('is refused, and says what to do about it', async () => {
    validateLaunch.mockResolvedValue({ ok: false, reason: 'unregistered-platform' });

    const res = await post(await goodLaunch());

    expect(res.status).toBe(403);
    expect(await res.text()).toContain('not registered');
  });

  // These are the entries an administrator reads when somebody cannot get in.
  it('is recorded as a security event', async () => {
    validateLaunch.mockResolvedValue({ ok: false, reason: 'bad-signature' });

    await post(await goodLaunch());

    const entry = await prisma.activityLog.findFirst({ where: { action: 'LTI_LAUNCH_DENIED' } });
    expect(entry?.severity).toBe('SECURITY');
    expect(entry?.metadata).toMatchObject({ reason: 'bad-signature' });
  });

  it('mints no ticket', async () => {
    validateLaunch.mockResolvedValue({ ok: false, reason: 'bad-signature' });

    await post(await goodLaunch());

    expect(await prisma.singleUseToken.count({ where: { purpose: 'LTI_SESSION_TICKET' } })).toBe(0);
  });
});

describe('a launch that verifies but cannot be signed in', () => {
  it('tells an administrator what to do when no account came back with the refusal', async () => {
    resolveLaunchSignIn.mockResolvedValue({
      ok: false,
      reason: 'admin-requires-deliberate-link',
    });

    const res = await post(await goodLaunch());

    expect(res.status).toBe(403);
    // Whatever it says has to be doable: the account page cannot attach an LMS identity.
    expect(await res.text()).toContain('open AFCT from your LMS again');
    expect(await prisma.singleUseToken.count({ where: { purpose: 'LTI_SESSION_TICKET' } })).toBe(0);
  });

  /**
   * The way through for an administrator. The rule that refuses an automatic link stands,
   * because the match rests on an email the LMS asserts; asking for the AFCT password, which
   * an LMS cannot assert, turns it into a deliberate act instead of a wall.
   */
  it('sends an administrator to confirm with their password, and signs nobody in yet', async () => {
    const admin = await prisma.user.create({
      data: { email: 'admin-launch@example.edu', isAdmin: true, firstName: 'A', lastName: 'D' },
      select: { id: true },
    });
    resolveLaunchSignIn.mockResolvedValue({
      ok: false,
      reason: 'admin-requires-deliberate-link',
      userId: admin.id,
    });

    const res = await post(await goodLaunch());

    expect(res.status).toBe(303);
    expect(new URL(res.headers.get('location') ?? '', 'https://x').pathname).toBe('/lti/confirm');

    const pending = await prisma.ltiPendingIdentityLink.findFirst({
      where: { userId: admin.id },
      select: { subject: true, issuer: true },
    });
    // The identity to attach is taken from the launch, not from whatever the browser sends back.
    expect(pending?.subject).toBeTruthy();
    expect(pending?.issuer).toBeTruthy();
    // Nothing is signed in until the password is given.
    expect(await prisma.singleUseToken.count({ where: { purpose: 'LTI_SESSION_TICKET' } })).toBe(0);
  });

  /**
   * The pause must not act on the claim it exists to doubt.
   *
   * An LMS asserting an administrator's email is exactly what the password confirms, so nothing
   * the launch said about that person may be written down before it. Working out where they
   * were headed is a courtesy, and a courtesy that records LMS-asserted facts is a side effect
   * nobody asked for.
   */
  it('records nothing about an administrator before the password', async () => {
    await withCourse();
    // Already connected, which is the case that writes: an unlinked course has nothing to
    // record against.
    const link = await prisma.ltiContextLink.create({
      data: {
        platformId: PLATFORM_ID,
        contextId: 'ctx-1',
        courseId: COURSE,
        lineItemsUrl: 'https://canvas.example.test/old/line_items',
        membershipsUrl: 'https://canvas.example.test/old/memberships',
      },
      select: { id: true },
    });
    const admin = await prisma.user.create({
      data: { email: 'admin-nowrite@example.edu', isAdmin: true, firstName: 'A', lastName: 'D' },
      select: { id: true },
    });
    resolveLaunchSignIn.mockResolvedValue({
      ok: false,
      reason: 'admin-requires-deliberate-link',
      userId: admin.id,
    });
    const before = await prisma.ltiContextLink.findUniqueOrThrow({
      where: { id: link.id },
      select: { lineItemsUrl: true, membershipsUrl: true },
    });

    await post(await goodLaunch());

    // No membership recorded against the account the LMS claimed.
    expect(await prisma.ltiContextMember.count({ where: { userId: admin.id } })).toBe(0);
    // And the service endpoints the launch advertised are not adopted either.
    expect(
      await prisma.ltiContextLink.findUniqueOrThrow({
        where: { id: link.id },
        select: { lineItemsUrl: true, membershipsUrl: true },
      }),
    ).toEqual(before);
  });

  /**
   * The pause has to remember what the launch was for.
   *
   * Staff launching from a course that is not connected yet came to connect it. The
   * confirmation cannot work that out for itself: the launch token is single use and spent by
   * then, so unless the destination is written down here, giving the password lands them on the
   * dashboard with no mention of the course, which reads as the link having failed.
   */
  it('remembers that the launch was going to the course picker', async () => {
    // Staff launching from a course that is not connected yet came to connect it.
    await withCourse();
    const admin = await prisma.user.create({
      data: { email: 'admin-picker@example.edu', isAdmin: true, firstName: 'A', lastName: 'D' },
      select: { id: true },
    });
    validateLaunch.mockResolvedValue({
      ok: true,
      identity: {
        ...identity,
        roles: ['http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor'],
      },
    });
    resolveLaunchSignIn.mockResolvedValue({
      ok: false,
      reason: 'admin-requires-deliberate-link',
      userId: admin.id,
    });

    await post(await goodLaunch());

    const pending = await prisma.ltiPendingIdentityLink.findFirst({
      where: { userId: admin.id },
      select: { next: true },
    });
    // Without this the password is asked for and then answered with the dashboard, which reads
    // as the link having failed.
    expect(pending?.next).toMatch(/^\/lti\/link\?pending=/);

    // And the picker it points at exists by the time they arrive.
    const id = pending?.next?.split('=')[1] ?? '';
    expect(
      await prisma.ltiPendingLink.findUnique({ where: { id }, select: { id: true } }),
    ).toBeTruthy();
  });

  it('does not enrol an unconfirmed administrator on a course that is already linked', async () => {
    // The whole reason for the pause: an LMS asserting an administrator's email is the claim
    // being doubted, so nothing may act on it until the password proves it.
    await withCourse();
    await prisma.ltiContextLink.create({
      data: { platformId: PLATFORM_ID, contextId: 'ctx-1', courseId: COURSE },
    });
    const admin = await prisma.user.create({
      data: { email: 'admin-linked@example.edu', isAdmin: true, firstName: 'A', lastName: 'D' },
      select: { id: true },
    });
    resolveLaunchSignIn.mockResolvedValue({
      ok: false,
      reason: 'admin-requires-deliberate-link',
      userId: admin.id,
    });

    await post(await goodLaunch());

    expect(await prisma.roster.count({ where: { userId: admin.id } })).toBe(0);
  });
});

/**
 * The cookie-less path, for browsers that refuse a third-party cookie.
 *
 * Safari drops the state cookie outright, so the launch used to fail its state check with a
 * message about cookies and no way forward. The platform can hold the state instead, but only a
 * page can read it back, so the launch has to pause rather than be refused.
 */
describe('a launch that arrives without its cookie', () => {
  const noCookiePost = (state: string) =>
    POST(
      new Request('https://afct.test/api/lti/launch', {
        method: 'POST',
        body: new URLSearchParams({ id_token: 'a-token', state }),
      }),
    );

  it('pauses for the platform storage, holding the token, when the platform offered storage', async () => {
    await withCourse();
    const { state } = await startLaunch({
      platformId: PLATFORM_ID,
      // What `lti_storage_target` at login recorded: this platform can keep a value for us.
      storageTarget: 'post_message_forwarding',
    });

    const res = await noCookiePost(state);

    // Paused, not refused: on to the page that can read what the platform kept.
    expect(res.status).toBe(303);
    const location = new URL(res.headers.get('location') ?? '', 'https://afct.test');
    expect(location.pathname).toBe('/lti/state-check');
    // Only the state travels. The frame the platform named is already on the launch row, and
    // reading it back from the URL would let whoever holds the link choose which frame is
    // asked for this launch's state.
    expect(location.searchParams.get('target')).toBeNull();
    expect(location.searchParams.get('state')).toBe(state);

    // The token waits on its own launch row rather than being handed back through the browser.
    const row = await prisma.ltiLaunchTransaction.findFirst({
      where: { storageTarget: 'post_message_forwarding' },
      select: { idToken: true, usedAt: true },
    });
    expect(row?.idToken).toBe('a-token');
    // And the launch is not spent yet, so the state still has to be answered for.
    expect(row?.usedAt).toBeNull();
  });

  it('refuses outright when the platform offered no storage', async () => {
    // Nothing to ask, so nothing to wait for: the behaviour every launch had before.
    await withCourse();
    const { state } = await startLaunch({ platformId: PLATFORM_ID });

    const res = await noCookiePost(state);

    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/third-party cookies/);
  });

  it('refuses a state it never issued, storage or not', async () => {
    // The pause must not become a way to complete an arbitrary launch.
    const res = await noCookiePost('never-issued');

    expect(res.status).toBe(400);
  });
});
