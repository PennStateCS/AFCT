import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { issueSingleUseToken } from '@/lib/single-use-token';
import { LTI_STATE_COOKIE } from '@/lib/lti/login-init';

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
      headers: opts.cookieState ? { cookie: `${LTI_STATE_COOKIE}=${opts.cookieState}` } : undefined,
    }),
  );
}

async function destroyFixtures() {
  await prisma.activityLog.deleteMany({ where: { action: 'LTI_LAUNCH_DENIED' } });
  await prisma.ltiPendingLink.deleteMany({});
  await prisma.ltiContextLink.deleteMany({});
  await prisma.roster.deleteMany({ where: { courseId: 'c-launch-dest' } });
  await prisma.course.deleteMany({ where: { id: 'c-launch-dest' } });
  await prisma.ltiPlatform.deleteMany({ where: { id: 'ltip-1' } });
  await prisma.singleUseToken.deleteMany({
    where: { purpose: { in: ['LTI_LAUNCH_STATE', 'LTI_SESSION_TICKET'] } },
  });
  await prisma.user.deleteMany({ where: { id: USER_ID } });
}

/** A launch that is going to work: valid state, cookie that matches, token that verifies. */
async function goodLaunch() {
  const { token: state } = await issueSingleUseToken({
    purpose: 'LTI_LAUNCH_STATE',
    ttlMs: 60_000,
  });
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
describe('where a launch lands', () => {
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

  const nextOf = (res: Response) => new URL(res.headers.get('location')!).searchParams.get('next');

  it('goes to the course when the LMS course is linked', async () => {
    await withCourse();
    await prisma.ltiContextLink.create({
      data: { platformId: PLATFORM_ID, contextId: 'ctx-1', courseId: COURSE },
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

    expect(res.headers.get('set-cookie') ?? '').toContain(`${LTI_STATE_COOKIE}=`);
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

  it('refuses a state AFCT never issued, even with a matching cookie', async () => {
    const res = await post({ state: 'made-up', cookieState: 'made-up', idToken: 'a-token' });

    expect(res.status).toBe(400);
    expect(validateLaunch).not.toHaveBeenCalled();
  });

  it('refuses the same launch a second time', async () => {
    const launch = await goodLaunch();

    expect((await post(launch)).status).toBe(303);
    expect((await post(launch)).status).toBe(400);
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
  it('tells an administrator to connect their account deliberately', async () => {
    resolveLaunchSignIn.mockResolvedValue({
      ok: false,
      reason: 'admin-requires-deliberate-link',
    });

    const res = await post(await goodLaunch());

    expect(res.status).toBe(403);
    expect(await res.text()).toContain('account page');
    expect(await prisma.singleUseToken.count({ where: { purpose: 'LTI_SESSION_TICKET' } })).toBe(0);
  });
});
