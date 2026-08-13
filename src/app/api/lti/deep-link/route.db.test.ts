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
const ids = { faculty: 'u-dl-faculty', outsider: 'u-dl-outsider' };

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
      { id: ids.outsider, email: 'dloutsider@example.test', password: 'x' },
    ],
  });
  await prisma.course.createMany({
    data: [
      { id: COURSE, name: 'Theory', ...courseFields },
      { id: OTHER_COURSE, name: 'Somebody else’s', ...courseFields },
    ],
  });
  await prisma.roster.create({ data: { courseId: COURSE, userId: ids.faculty, role: 'FACULTY' } });
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
