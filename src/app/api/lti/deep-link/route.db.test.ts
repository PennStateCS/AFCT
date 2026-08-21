import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { createKeyPair } from '@/lib/lti/keys';

/**
 * Returning a chosen assignment to the LMS, against a real Postgres.
 *
 * Two rules carry it. Where AFCT posts its signed answer comes from the stored request, never
 * from the form. And the person choosing must run the course, checked here as well as on the
 * page, because a form can be posted directly.
 */

const ISSUER = 'Client';
const PLATFORM = 'ltip-dl';
const COURSE = 'c-dl';
const OTHER_COURSE = 'c-dl-other';
const RETURN_URL = 'https://lti-ri.imsglobal.org/platforms/6455/deep_links';
const ids = {
  faculty: 'u-dl-faculty',
  // A second person who also runs the course, so a retry can be told apart from the first try.
  colleague: 'u-dl-colleague',
  outsider: 'u-dl-outsider',
};

const session = vi.hoisted(() => ({
  current: null as { user: { id: string; isAdmin: boolean } } | null,
}));
vi.mock('@/lib/auth', () => ({ auth: async () => session.current }));

const { POST } = await import('./route');

const post = (fields: Record<string, string>) => {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.append(k, v);
  return POST(
    new Request('https://afct.test/api/lti/deep-link', {
      method: 'POST',
      body,
      headers: { 'x-nonce': 'nonce-abc' },
    }),
  );
};

const courseFields = {
  code: 'CMPSC 464',
  semester: 'Fall 2026',
  credits: 3,
  startDate: new Date('2026-08-24T00:00:00Z'),
  endDate: new Date('2026-12-18T00:00:00Z'),
};

async function destroyFixtures() {
  await prisma.activityLog.deleteMany({ where: { courseId: { in: [COURSE, OTHER_COURSE] } } });
  await prisma.ltiDeepLink.deleteMany({ where: { contextLink: { platformId: PLATFORM } } });
  await prisma.ltiContextLink.deleteMany({ where: { platformId: PLATFORM } });
  await prisma.ltiPendingDeepLink.deleteMany({ where: { platformId: PLATFORM } });
  await prisma.assignment.deleteMany({ where: { courseId: { in: [COURSE, OTHER_COURSE] } } });
  await prisma.roster.deleteMany({ where: { courseId: { in: [COURSE, OTHER_COURSE] } } });
  await prisma.ltiPlatform.deleteMany({ where: { id: PLATFORM } });
  await prisma.course.deleteMany({ where: { id: { in: [COURSE, OTHER_COURSE] } } });
  await prisma.user.deleteMany({ where: { id: { in: Object.values(ids) } } });
  await prisma.ltiKeyPair.deleteMany({});
}

beforeEach(async () => {
  await destroyFixtures();
  await createKeyPair();
  await prisma.user.createMany({
    data: [
      { id: ids.faculty, email: 'dlfaculty@example.test', password: 'x' },
      { id: ids.colleague, email: 'dlcolleague@example.test', password: 'x' },
      { id: ids.outsider, email: 'dloutsider@example.test', password: 'x' },
    ],
  });
  await prisma.course.createMany({
    data: [
      { id: COURSE, name: 'Theory', ...courseFields },
      { id: OTHER_COURSE, name: 'Somebody else’s', ...courseFields },
    ],
  });
  await prisma.roster.createMany({
    data: [
      { courseId: COURSE, userId: ids.faculty, role: 'FACULTY' },
      { courseId: COURSE, userId: ids.colleague, role: 'FACULTY' },
    ],
  });
  await prisma.assignment.createMany({
    data: [
      { id: 'a-dl', courseId: COURSE, title: 'Problem set 1', dueDate: new Date() },
      { id: 'a-dl-other', courseId: OTHER_COURSE, title: 'Not yours', dueDate: new Date() },
    ],
  });
  await prisma.ltiPlatform.create({
    data: {
      id: PLATFORM,
      name: 'Canvas',
      issuer: ISSUER,
      clientId: 'AFCT',
      deploymentId: '1',
      authLoginUrl: 'https://x.test/auth',
      tokenUrl: 'https://x.test/token',
      keysetUrl: 'https://x.test/jwks',
    },
  });
  await prisma.ltiContextLink.create({
    data: { id: 'cl-dl', platformId: PLATFORM, contextId: 'ctx-1', courseId: COURSE },
  });
  await prisma.ltiPendingDeepLink.create({
    data: {
      id: 'pdl-1',
      platformId: PLATFORM,
      contextId: 'ctx-1',
      returnUrl: RETURN_URL,
      data: 'platform-state',
      // What Deep Linking 2.0 requires of the request this row was made from. A pending choice
      // only exists because a launch was validated, so these are always present in practice.
      acceptTypes: ['ltiResourceLink'],
      acceptPresentationDocumentTargets: ['iframe', 'window'],
      acceptLineItem: true,
      userId: ids.faculty,
      expiresAt: new Date(Date.now() + 60_000),
    },
  });
  session.current = { user: { id: ids.faculty, isAdmin: false } };
});

afterAll(async () => {
  await destroyFixtures();
  await prisma.$disconnect();
});

describe('returning a choice', () => {
  it('answers with a form that posts to the platform', async () => {
    const res = await post({ pendingId: 'pdl-1', assignmentId: 'a-dl' });
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(html).toContain(`action="${RETURN_URL}"`);
    expect(html).toContain('name="JWT"');
  });

  // Without it the policy blocks the script in production and the page sits there.
  it('carries the request nonce into the page', async () => {
    const html = await (await post({ pendingId: 'pdl-1', assignmentId: 'a-dl' })).text();

    expect(html).toContain('<script nonce="nonce-abc">');
  });

  it('spends the request, so it cannot be answered twice', async () => {
    await post({ pendingId: 'pdl-1', assignmentId: 'a-dl' });

    expect(await prisma.ltiPendingDeepLink.count({ where: { id: 'pdl-1' } })).toBe(0);
    expect((await post({ pendingId: 'pdl-1', assignmentId: 'a-dl' })).status).toBe(400);
  });

  it('records what was linked', async () => {
    await post({ pendingId: 'pdl-1', assignmentId: 'a-dl' });

    const entry = await prisma.activityLog.findFirstOrThrow({
      where: { action: 'LTI_DEEP_LINK_RETURNED' },
    });
    expect(entry.metadata).toMatchObject({ assignmentTitle: 'Problem set 1' });
  });
});

/**
 * AFCT signs what it sends, so where it sends it must not be a caller's decision. Posting a
 * return URL is the obvious attempt, and it has to be ignored rather than trusted.
 */
describe('where the answer goes', () => {
  it('is the stored URL, whatever the form says', async () => {
    const html = await (
      await post({
        pendingId: 'pdl-1',
        assignmentId: 'a-dl',
        returnUrl: 'https://attacker.test/collect',
      })
    ).text();

    expect(html).toContain(`action="${RETURN_URL}"`);
    expect(html).not.toContain('attacker.test');
  });
});

describe('what it refuses', () => {
  /**
   * The check that stops a deep link becoming a way to attach somebody else's assignment to
   * your own LMS course. The page checks too; this is the one that holds when the form is
   * posted directly.
   */
  it('an assignment from a course the person does not run', async () => {
    const res = await post({ pendingId: 'pdl-1', assignmentId: 'a-dl-other' });

    expect(res.status).toBe(403);
    expect(await prisma.ltiPendingDeepLink.count({ where: { id: 'pdl-1' } })).toBe(1);
  });

  it('somebody else’s pending request', async () => {
    session.current = { user: { id: ids.outsider, isAdmin: false } };

    expect((await post({ pendingId: 'pdl-1', assignmentId: 'a-dl' })).status).toBe(400);
  });

  it('a request that has expired', async () => {
    await prisma.ltiPendingDeepLink.update({
      where: { id: 'pdl-1' },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    expect((await post({ pendingId: 'pdl-1', assignmentId: 'a-dl' })).status).toBe(400);
  });

  it('a caller who is not signed in', async () => {
    session.current = null;

    expect((await post({ pendingId: 'pdl-1', assignmentId: 'a-dl' })).status).toBe(401);
  });
});

/**
 * Creating the assignment from inside the LMS.
 *
 * Faculty adding a link are usually building the assignment at that moment, and sending them
 * back to AFCT to make one first is where the old flow stopped being useful.
 */
describe('creating an assignment from the picker', () => {
  const create = (fields: Record<string, string> = {}) =>
    post({
      pendingId: 'pdl-1',
      mode: 'create',
      title: 'Pumping lemma',
      dueDate: '2026-09-30',
      isPublished: 'on',
      ...fields,
    });

  it('creates it in the course the LMS course opens, and links it', async () => {
    const res = await create();

    expect(res.status).toBe(200);
    const created = await prisma.assignment.findFirstOrThrow({
      where: { courseId: COURSE, title: 'Pumping lemma' },
    });
    expect(created.isPublished).toBe(true);
    // The link is what stops it being offered again.
    expect(
      await prisma.ltiDeepLink.count({
        where: { assignmentId: created.id, contextLinkId: 'cl-dl' },
      }),
    ).toBe(1);
  });

  it('leaves it unpublished when the box is cleared', async () => {
    await create({ isPublished: '' });

    const created = await prisma.assignment.findFirstOrThrow({ where: { title: 'Pumping lemma' } });
    expect(created.isPublished).toBe(false);
  });

  it('records it as an assignment anybody made, with how it happened', async () => {
    await create();

    const entry = await prisma.activityLog.findFirstOrThrow({
      where: { action: 'CREATE_ASSIGNMENT', courseId: COURSE },
    });
    expect(entry.metadata).toMatchObject({ title: 'Pumping lemma', via: 'lti-deep-link' });
  });

  it('sends them back to the form when the title is missing, rather than to a dead end', async () => {
    const res = await create({ title: '' });

    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toContain('mode=create&error=missing-title');
    // Nothing half-made is left behind.
    expect(await prisma.assignment.count({ where: { courseId: COURSE, title: '' } })).toBe(0);
    expect(await prisma.ltiPendingDeepLink.count({ where: { id: 'pdl-1' } })).toBe(1);
  });

  it('refuses an available-from date after the due date', async () => {
    const res = await create({ unlockAt: '2026-10-30' });

    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toContain('error=bad-dates');
  });
});

/**
 * One link per assignment per LMS course. Two links to the same work means two gradebook
 * columns for it, and the grades then disagree about which is real.
 */
describe('adding the same assignment twice', () => {
  const secondRequest = () =>
    prisma.ltiPendingDeepLink.create({
      data: {
        id: 'pdl-2',
        platformId: PLATFORM,
        contextId: 'ctx-1',
        returnUrl: RETURN_URL,
        data: 'platform-state',
        acceptTypes: ['ltiResourceLink'],
        acceptPresentationDocumentTargets: ['iframe', 'window'],
        acceptLineItem: true,
        userId: ids.faculty,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

  /** The launch AFCT would have seen had the platform kept the first response. */
  const confirmTheLink = () =>
    prisma.ltiDeepLink.updateMany({
      where: { assignmentId: 'a-dl' },
      data: { confirmedAt: new Date() },
    });

  it('is refused once the LMS has opened the link, and says so on the picker', async () => {
    await post({ pendingId: 'pdl-1', assignmentId: 'a-dl' });
    await confirmTheLink();
    await secondRequest();

    const res = await post({ pendingId: 'pdl-2', assignmentId: 'a-dl' });

    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toContain('error=already-linked');
    expect(await prisma.ltiDeepLink.count({ where: { assignmentId: 'a-dl' } })).toBe(1);
  });

  it('records the link on the first pass, so the picker can leave it out', async () => {
    await post({ pendingId: 'pdl-1', assignmentId: 'a-dl' });

    const row = await prisma.ltiDeepLink.findFirstOrThrow({ where: { assignmentId: 'a-dl' } });
    expect(row.contextLinkId).toBe('cl-dl');
    expect(row.createdByUserId).toBe(ids.faculty);
    // Nothing has opened it, so AFCT does not yet know the platform kept it.
    expect(row.confirmedAt).toBeNull();
  });
});

/**
 * #697. Moodle refused three responses in a row while its keyset fetch was broken, and each
 * one left AFCT holding a link that nothing in Moodle opened. The picker then hid those three
 * assignments for good, because a row was a row.
 */
describe('answering again when the first response was never kept', () => {
  const secondRequest = () =>
    prisma.ltiPendingDeepLink.create({
      data: {
        id: 'pdl-3',
        platformId: PLATFORM,
        contextId: 'ctx-1',
        returnUrl: RETURN_URL,
        data: 'platform-state',
        acceptTypes: ['ltiResourceLink'],
        acceptPresentationDocumentTargets: ['iframe', 'window'],
        acceptLineItem: true,
        userId: ids.colleague,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

  /** The refused first answer, then a colleague picking the same assignment again. */
  const answerTwice = async () => {
    await post({ pendingId: 'pdl-1', assignmentId: 'a-dl' });
    await secondRequest();
    session.current = { user: { id: ids.colleague, isAdmin: false } };
    return post({ pendingId: 'pdl-3', assignmentId: 'a-dl' });
  };

  it('sends another response rather than dead-ending on the picker', async () => {
    const res = await answerTwice();

    expect(res.status).toBe(200);
    expect(await res.text()).toContain('name="JWT"');
  });

  it('still holds one link, since the LMS may have kept either response', async () => {
    await answerTwice();

    expect(await prisma.ltiDeepLink.count({ where: { assignmentId: 'a-dl' } })).toBe(1);
  });

  /**
   * The first attempt never reached the LMS, so the person who sent the response that can still
   * be accepted is the one the assignment's Settings tab should name.
   */
  it('names whoever sent the response that is now live', async () => {
    await answerTwice();

    const row = await prisma.ltiDeepLink.findFirstOrThrow({ where: { assignmentId: 'a-dl' } });
    expect(row.createdByUserId).toBe(ids.colleague);
    expect(row.confirmedAt).toBeNull();
  });

  /** The retry runs the whole tail, so the request is spent and both attempts are on record. */
  it('spends the second request and logs the attempt as a retry', async () => {
    await answerTwice();

    expect(await prisma.ltiPendingDeepLink.count({ where: { id: 'pdl-3' } })).toBe(0);

    const entries = await prisma.activityLog.findMany({
      where: { action: 'LTI_DEEP_LINK_RETURNED' },
      orderBy: { timestamp: 'asc' },
    });
    expect(entries).toHaveLength(2);
    expect(entries[1]?.metadata).toMatchObject({ retry: true });
    expect(entries[0]?.metadata).not.toMatchObject({ retry: true });
  });
});
