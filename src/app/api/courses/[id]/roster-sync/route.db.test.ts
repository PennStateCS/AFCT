import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { createKeyPair } from '@/lib/lti/keys';

/**
 * Previewing and applying a roster sync, against a real Postgres.
 *
 * The preview must change nothing, and applying must re-read the LMS rather than trusting
 * anything the browser sends: what gets applied is what the LMS says now, and a caller cannot
 * hand-craft a set of changes to a course.
 */

const ISSUER = 'https://canvas.example.test';
const PLATFORM = 'ltip-sync-route';
const COURSE = 'c-sync-route';
const ids = { faculty: 'u-sr-faculty', student: 'u-sr-student', outsider: 'u-sr-outsider' };

const session = vi.hoisted(() => ({
  current: null as { user: { id: string; isAdmin: boolean } } | null,
}));
vi.mock('@/lib/auth', () => ({ auth: async () => session.current }));

const { GET, POST } = await import('./route');

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

/** An LMS listing one student nobody in AFCT has seen. */
function lmsWith(members: unknown[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url.endsWith('/token') ? json({ access_token: 'tok', expires_in: 3600 }) : json({ members }),
    ),
  );
}

const learner = {
  user_id: 'lms-1',
  email: 'newstudent@example.test',
  given_name: 'Ada',
  family_name: 'Lovelace',
  roles: ['http://purl.imsglobal.org/vocab/lis/v2/membership#Learner'],
  status: 'Active',
};

const call = (method: 'GET' | 'POST') => {
  const ctx = { params: Promise.resolve({ id: COURSE }) };
  return method === 'GET'
    ? GET(new Request(`https://afct.test/api/courses/${COURSE}/roster-sync`), ctx)
    : POST(
        new Request(`https://afct.test/api/courses/${COURSE}/roster-sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ confirm: true }),
        }),
        ctx,
      );
};

async function destroyFixtures() {
  await prisma.activityLog.deleteMany({ where: { courseId: COURSE } });
  await prisma.linkedIdentity.deleteMany({ where: { issuer: ISSUER } });
  await prisma.roster.deleteMany({ where: { courseId: COURSE } });
  await prisma.ltiContextLink.deleteMany({ where: { platformId: PLATFORM } });
  await prisma.ltiPlatform.deleteMany({ where: { id: PLATFORM } });
  await prisma.course.deleteMany({ where: { id: COURSE } });
  await prisma.user.deleteMany({
    where: { OR: [{ id: { in: Object.values(ids) } }, { email: 'newstudent@example.test' }] },
  });
  await prisma.ltiKeyPair.deleteMany({});
}

beforeEach(async () => {
  await destroyFixtures();
  await createKeyPair();
  await prisma.user.createMany({
    data: [
      { id: ids.faculty, email: 'srfaculty@example.test', password: 'x' },
      { id: ids.student, email: 'srstudent@example.test', password: null },
      { id: ids.outsider, email: 'sroutsider@example.test', password: 'x' },
    ],
  });
  await prisma.course.create({
    data: {
      id: COURSE,
      name: 'Theory',
      code: 'CMPSC 464',
      semester: 'Fall 2026',
      credits: 3,
      startDate: new Date('2026-08-24T00:00:00Z'),
      endDate: new Date('2026-12-18T00:00:00Z'),
    },
  });
  await prisma.roster.create({
    data: { courseId: COURSE, userId: ids.faculty, role: 'FACULTY' },
  });
  await prisma.ltiPlatform.create({
    data: {
      id: PLATFORM,
      name: 'Canvas',
      issuer: ISSUER,
      clientId: 'client-1',
      deploymentId: '1',
      authLoginUrl: `${ISSUER}/auth`,
      tokenUrl: `${ISSUER}/token`,
      keysetUrl: `${ISSUER}/jwks`,
    },
  });
  await prisma.ltiContextLink.create({
    data: {
      platformId: PLATFORM,
      contextId: 'ctx-1',
      courseId: COURSE,
      membershipsUrl: `${ISSUER}/contexts/1/memberships`,
    },
  });
  session.current = { user: { id: ids.faculty, isAdmin: false } };
});

afterEach(() => vi.unstubAllGlobals());

afterAll(async () => {
  await destroyFixtures();
  await prisma.$disconnect();
});

describe('the preview', () => {
  it('reports what would change', async () => {
    lmsWith([learner]);

    const body = await (await call('GET')).json();

    expect(body.changes).toContainEqual(expect.objectContaining({ kind: 'add' }));
  });

  // The whole reason it is split from applying.
  it('changes nothing', async () => {
    lmsWith([learner]);

    await call('GET');

    expect(await prisma.roster.count({ where: { courseId: COURSE } })).toBe(1);
    expect(await prisma.user.count({ where: { email: 'newstudent@example.test' } })).toBe(0);
  });

  it('reports an LMS that cannot be read, rather than pretending nothing changed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.endsWith('/token')
          ? json({ access_token: 'tok', expires_in: 3600 })
          : new Response('nope', { status: 403 }),
      ),
    );

    const res = await call('GET');

    expect(res.status).toBe(502);
    expect((await res.json()).error).toContain('refused');
  });
});

describe('applying', () => {
  it('makes the changes the preview described', async () => {
    lmsWith([learner]);

    const body = await (await call('POST')).json();

    expect(body).toMatchObject({ added: 1, accountsCreated: 1 });
    expect(await prisma.user.count({ where: { email: 'newstudent@example.test' } })).toBe(1);
  });

  /**
   * The request carries only a confirmation. Everything applied is re-read from the LMS, so a
   * caller cannot post a set of changes of their own devising.
   */
  it('ignores anything else in the request body', async () => {
    lmsWith([]);

    const res = await POST(
      new Request(`https://afct.test/api/courses/${COURSE}/roster-sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          confirm: true,
          changes: [{ kind: 'drop', userId: ids.faculty, name: 'Faculty', role: 'FACULTY' }],
        }),
      }),
      { params: Promise.resolve({ id: COURSE }) },
    );

    expect(res.status).toBe(200);
    // The LMS listed nobody, and staff are never dropped, so the faculty member survives.
    const row = await prisma.roster.findFirstOrThrow({ where: { userId: ids.faculty } });
    expect(row.status).toBe('ENROLLED');
  });

  it('refuses without a confirmation', async () => {
    lmsWith([learner]);

    const res = await POST(
      new Request(`https://afct.test/api/courses/${COURSE}/roster-sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ id: COURSE }) },
    );

    expect(res.status).toBe(400);
    expect(await prisma.user.count({ where: { email: 'newstudent@example.test' } })).toBe(0);
  });
});

describe('who may do this', () => {
  it('refuses somebody who does not run the course', async () => {
    lmsWith([learner]);
    session.current = { user: { id: ids.outsider, isAdmin: false } };

    expect((await call('GET')).status).toBe(403);
    expect((await call('POST')).status).toBe(403);
  });

  it('refuses somebody signed out', async () => {
    lmsWith([learner]);
    session.current = null;

    expect((await call('GET')).status).toBe(401);
  });

  it('says so when the course has no LMS', async () => {
    lmsWith([learner]);
    await prisma.ltiContextLink.deleteMany({ where: { platformId: PLATFORM } });

    expect((await call('GET')).status).toBe(404);
  });
});
