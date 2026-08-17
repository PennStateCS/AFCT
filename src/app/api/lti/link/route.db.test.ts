import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/prisma';

/**
 * Committing a course link, against a real Postgres.
 *
 * The rule being proved is that the LMS course identifier comes from the stored pending launch
 * and never from the request. If the caller could supply it, faculty could name somebody else's
 * LMS course and capture every launch from it.
 */

const session = vi.hoisted(() => ({ current: null as { user: { id: string } } | null }));
vi.mock('@/lib/auth', () => ({ auth: async () => session.current }));

const { POST } = await import('./route');

const ISSUER = 'https://canvas.example.test';
const PLATFORM = 'ltip-link';
const ids = { faculty: 'u-lk-faculty', other: 'u-lk-other' };
const COURSE = 'c-lk-1';
const OTHER_COURSE = 'c-lk-2';
const PENDING = 'pend-lk-1';

const post = (body: Record<string, unknown>) =>
  POST(
    new Request('https://afct.example.test/api/lti/link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );

async function destroyFixtures() {
  await prisma.ltiPendingLink.deleteMany({ where: { platformId: PLATFORM } });
  await prisma.ltiContextLink.deleteMany({ where: { platformId: PLATFORM } });
  await prisma.roster.deleteMany({ where: { courseId: { in: [COURSE, OTHER_COURSE] } } });
  await prisma.ltiPlatform.deleteMany({ where: { id: PLATFORM } });
  await prisma.course.deleteMany({ where: { id: { in: [COURSE, OTHER_COURSE] } } });
  await prisma.user.deleteMany({ where: { id: { in: Object.values(ids) } } });
}

beforeEach(async () => {
  await destroyFixtures();
  await prisma.user.createMany({
    data: [
      { id: ids.faculty, email: 'lk-faculty@example.test', password: 'x' },
      { id: ids.other, email: 'lk-other@example.test', password: 'x' },
    ],
  });
  const defaults = {
    code: 'CMPSC 464',
    semester: 'Fall 2026',
    credits: 3,
    startDate: new Date('2026-08-24T00:00:00Z'),
    endDate: new Date('2026-12-18T00:00:00Z'),
  };
  await prisma.course.createMany({
    data: [
      { id: COURSE, name: 'Mine', ...defaults },
      { id: OTHER_COURSE, name: 'Not mine', ...defaults },
    ],
  });
  await prisma.ltiPlatform.create({
    data: {
      id: PLATFORM,
      name: 'Test Canvas',
      issuer: ISSUER,
      clientId: 'client-1',
      deploymentId: 'deploy-1',
      authLoginUrl: `${ISSUER}/auth`,
      tokenUrl: `${ISSUER}/token`,
      keysetUrl: `${ISSUER}/jwks`,
    },
  });
  await prisma.roster.createMany({
    data: [
      { courseId: COURSE, userId: ids.faculty, role: 'FACULTY' },
      { courseId: OTHER_COURSE, userId: ids.other, role: 'FACULTY' },
    ],
  });
  await prisma.ltiPendingLink.create({
    data: {
      id: PENDING,
      platformId: PLATFORM,
      contextId: 'ctx-signed-by-the-platform',
      contextTitle: 'Theory of Computation',
      // What the launch was told about this course. Carried on the pending row because only a
      // launch is given them, and the browser that comes back to choose brings nothing.
      lineItemsUrl: 'https://canvas.example.test/api/lti/courses/1/line_items',
      membershipsUrl: 'https://canvas.example.test/api/lti/courses/1/names_and_roles',
      userId: ids.faculty,
      expiresAt: new Date(Date.now() + 60_000),
    },
  });
  session.current = { user: { id: ids.faculty } };
});

afterAll(async () => {
  await destroyFixtures();
  await prisma.$disconnect();
});

describe('linking a course', () => {
  it('links it and says where to go', async () => {
    const res = await post({ pendingId: PENDING, courseId: COURSE });

    expect(res.status).toBe(200);
    expect((await res.json()).courseId).toBe(COURSE);
  });

  /**
   * The identifier is the one the platform signed, taken from the stored pending launch. A
   * caller who could supply it could name somebody else's LMS course and capture its launches.
   */
  it('uses the stored LMS course, not anything the caller sends', async () => {
    await post({
      pendingId: PENDING,
      courseId: COURSE,
      contextId: 'somebody-elses-course',
      platformId: 'made-up',
    });

    const link = await prisma.ltiContextLink.findFirstOrThrow();
    expect(link.contextId).toBe('ctx-signed-by-the-platform');
    expect(link.platformId).toBe(PLATFORM);
  });

  it('spends the pending launch, so it cannot be used twice', async () => {
    await post({ pendingId: PENDING, courseId: COURSE });

    expect(await prisma.ltiPendingLink.count({ where: { id: PENDING } })).toBe(0);
    expect((await post({ pendingId: PENDING, courseId: COURSE })).status).toBe(400);
  });

  // Configuring a course must not make the person a student on it.
  it('does not enrol the person who linked it', async () => {
    await post({ pendingId: PENDING, courseId: COURSE });

    const roster = await prisma.roster.findMany({ where: { courseId: COURSE } });
    expect(roster).toHaveLength(1);
    expect(roster[0]).toMatchObject({ userId: ids.faculty, role: 'FACULTY' });
  });
});

describe('what it refuses', () => {
  it('a course the person does not run', async () => {
    const res = await post({ pendingId: PENDING, courseId: OTHER_COURSE });

    expect(res.status).toBe(403);
    expect(await prisma.ltiContextLink.count()).toBe(0);
  });

  // Scoped to the owner, so another person's pending launch is simply not there.
  it('somebody else’s pending launch', async () => {
    session.current = { user: { id: ids.other } };

    const res = await post({ pendingId: PENDING, courseId: OTHER_COURSE });

    expect(res.status).toBe(400);
    expect(await prisma.ltiContextLink.count()).toBe(0);
  });

  it('a pending launch that has expired', async () => {
    await prisma.ltiPendingLink.update({
      where: { id: PENDING },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const res = await post({ pendingId: PENDING, courseId: COURSE });

    expect(res.status).toBe(400);
    expect(await res.text()).toContain('expired');
  });

  it('a caller who is not signed in', async () => {
    session.current = null;

    expect((await post({ pendingId: PENDING, courseId: COURSE })).status).toBe(401);
  });

  it('an LMS course that is already linked elsewhere', async () => {
    await prisma.ltiContextLink.create({
      data: {
        platformId: PLATFORM,
        contextId: 'ctx-signed-by-the-platform',
        courseId: OTHER_COURSE,
      },
    });

    const res = await post({ pendingId: PENDING, courseId: COURSE });

    expect(res.status).toBe(409);
  });

  /**
   * The connected course has to be reachable afterwards.
   *
   * Linking through the picker used to store the course with no gradebook or roster endpoint,
   * because the route built an identity with both set to null and a comment saying they were
   * unused here. They are not unused: they are the only route to the LMS gradebook, and
   * without them every grade failed with a message blaming the LMS for a permission it had
   * already granted. That sends an administrator to change a setting that was already correct.
   */
  it('keeps the gradebook and roster endpoints the launch reported', async () => {
    const res = await post({ pendingId: PENDING, courseId: COURSE });
    expect(res.status).toBe(200);

    const link = await prisma.ltiContextLink.findFirst({
      where: { contextId: 'ctx-signed-by-the-platform' },
      select: { lineItemsUrl: true, membershipsUrl: true },
    });
    expect(link?.lineItemsUrl).toBe('https://canvas.example.test/api/lti/courses/1/line_items');
    expect(link?.membershipsUrl).toBe(
      'https://canvas.example.test/api/lti/courses/1/names_and_roles',
    );
  });
});
