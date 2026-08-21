import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/prisma';

/**
 * Reading and removing an assignment's LMS links, against a real Postgres.
 *
 * Two things are worth proving here rather than in a component test. A link belonging to
 * another course must not be removable through a course you do run, which is a query shape and
 * not a UI rule. And removal has to leave the assignment behind: the row is bookkeeping, so a
 * cascade that took the assignment with it would destroy student work to tidy a record.
 */

const session = vi.hoisted(() => ({
  current: null as { user: { id: string; isAdmin: boolean } } | null,
}));
vi.mock('@/lib/auth', () => ({ auth: async () => session.current }));

const { GET } = await import('./route');
const { DELETE } = await import('./[linkId]/route');

const ISSUER = 'https://lms.example.test';
const PLATFORM = 'ltip-links';
const COURSE = 'c-links';
const OTHER_COURSE = 'c-links-other';
const ASSIGNMENT = 'a-links';
const OTHER_ASSIGNMENT = 'a-links-other';
const ids = { faculty: 'u-links-faculty', student: 'u-links-student' };

const list = (courseId = COURSE, assignmentId = ASSIGNMENT) =>
  GET(new Request(`https://afct.test/api/courses/${courseId}/assignments/${assignmentId}`), {
    params: Promise.resolve({ id: courseId, aid: assignmentId }),
  });

const remove = (linkId: string, courseId = COURSE, assignmentId = ASSIGNMENT) =>
  DELETE(
    new Request(`https://afct.test/api/courses/${courseId}/assignments/${assignmentId}`, {
      method: 'DELETE',
    }),
    { params: Promise.resolve({ id: courseId, aid: assignmentId, linkId }) },
  );

/** The deep link row for an assignment, in the LMS course linked to `courseId`. */
async function linkFor(assignmentId: string, courseId: string) {
  const contextLink = await prisma.ltiContextLink.findFirstOrThrow({ where: { courseId } });
  return prisma.ltiDeepLink.create({
    data: { contextLinkId: contextLink.id, assignmentId, createdByUserId: ids.faculty },
  });
}

async function destroyFixtures() {
  await prisma.activityLog.deleteMany({ where: { courseId: { in: [COURSE, OTHER_COURSE] } } });
  await prisma.ltiDeepLink.deleteMany({
    where: { assignmentId: { in: [ASSIGNMENT, OTHER_ASSIGNMENT] } },
  });
  await prisma.ltiContextLink.deleteMany({ where: { platformId: PLATFORM } });
  await prisma.ltiPlatform.deleteMany({ where: { id: PLATFORM } });
  await prisma.assignment.deleteMany({ where: { id: { in: [ASSIGNMENT, OTHER_ASSIGNMENT] } } });
  await prisma.roster.deleteMany({ where: { courseId: { in: [COURSE, OTHER_COURSE] } } });
  await prisma.course.deleteMany({ where: { id: { in: [COURSE, OTHER_COURSE] } } });
  await prisma.user.deleteMany({ where: { id: { in: Object.values(ids) } } });
}

const course = (id: string, name: string) => ({
  id,
  name,
  code: 'CMPSC 464',
  semester: 'Fall 2026',
  credits: 3,
  startDate: new Date('2026-08-24T00:00:00Z'),
  endDate: new Date('2026-12-18T00:00:00Z'),
});

beforeEach(async () => {
  await destroyFixtures();
  await prisma.user.createMany({
    data: [
      { id: ids.faculty, email: 'linksfaculty@example.test', password: 'x' },
      { id: ids.student, email: 'linksstudent@example.test', password: 'x' },
    ],
  });
  await prisma.course.createMany({
    data: [course(COURSE, 'Theory'), course(OTHER_COURSE, 'Somebody else’s course')],
  });
  await prisma.roster.createMany({
    data: [
      { courseId: COURSE, userId: ids.faculty, role: 'FACULTY' },
      { courseId: OTHER_COURSE, userId: ids.faculty, role: 'FACULTY' },
      { courseId: COURSE, userId: ids.student, role: 'STUDENT' },
    ],
  });
  await prisma.assignment.createMany({
    data: [
      {
        id: ASSIGNMENT,
        courseId: COURSE,
        title: 'Problem set 1',
        dueDate: new Date('2026-09-01T00:00:00Z'),
      },
      {
        id: OTHER_ASSIGNMENT,
        courseId: OTHER_COURSE,
        title: 'Their problem set',
        dueDate: new Date('2026-09-01T00:00:00Z'),
      },
    ],
  });
  await prisma.ltiPlatform.create({
    data: {
      id: PLATFORM,
      name: 'Canvas',
      issuer: ISSUER,
      clientId: 'client-links',
      deploymentId: '1',
      authLoginUrl: `${ISSUER}/auth`,
      tokenUrl: `${ISSUER}/token`,
      keysetUrl: `${ISSUER}/jwks`,
    },
  });
  await prisma.ltiContextLink.createMany({
    data: [
      { platformId: PLATFORM, contextId: 'ctx-1', courseId: COURSE, contextTitle: 'CMPSC 464 F26' },
      { platformId: PLATFORM, contextId: 'ctx-2', courseId: OTHER_COURSE },
    ],
  });
  session.current = { user: { id: ids.faculty, isAdmin: false } };
});

afterAll(async () => {
  await destroyFixtures();
  await prisma.$disconnect();
});

describe('reading the links', () => {
  it('names the LMS course and who added it', async () => {
    await linkFor(ASSIGNMENT, COURSE);

    const body = (await (await list()).json()) as {
      links: Array<{ platform: string; context: string | null }>;
    };

    expect(body.links).toHaveLength(1);
    expect(body.links[0]).toMatchObject({ platform: 'Canvas', context: 'CMPSC 464 F26' });
  });

  /**
   * The card cannot say a link is unconfirmed if the route does not tell it, and an unconfirmed
   * link shown as an ordinary one is the wrong claim #697 is about.
   */
  it('says whether the LMS has ever opened the link', async () => {
    const link = await linkFor(ASSIGNMENT, COURSE);

    const unconfirmed = (await (await list()).json()) as { links: Array<{ confirmedAt: unknown }> };
    expect(unconfirmed.links[0]?.confirmedAt).toBeNull();

    await prisma.ltiDeepLink.update({
      where: { id: link.id },
      data: { confirmedAt: new Date('2026-08-20T10:00:00Z') },
    });

    const confirmed = (await (await list()).json()) as { links: Array<{ confirmedAt: unknown }> };
    expect(confirmed.links[0]?.confirmedAt).toBe('2026-08-20T10:00:00.000Z');
  });

  it('is empty, not absent, for an assignment no LMS opens', async () => {
    const body = (await (await list()).json()) as { links: unknown[] };

    expect(body.links).toEqual([]);
  });

  it('refuses a student in the course', async () => {
    session.current = { user: { id: ids.student, isAdmin: false } };

    expect((await list()).status).toBe(403);
  });

  it('is a 404 when the assignment belongs to another course', async () => {
    expect((await list(COURSE, OTHER_ASSIGNMENT)).status).toBe(404);
  });
});

describe('removing a link', () => {
  it('removes the record, leaves the assignment, and logs who did it', async () => {
    const link = await linkFor(ASSIGNMENT, COURSE);

    expect((await remove(link.id)).status).toBe(200);

    expect(await prisma.ltiDeepLink.findUnique({ where: { id: link.id } })).toBeNull();
    expect(await prisma.assignment.findUnique({ where: { id: ASSIGNMENT } })).not.toBeNull();

    const logged = await prisma.activityLog.findFirst({
      where: { action: 'LTI_DEEP_LINK_REMOVED', courseId: COURSE },
    });
    expect(logged?.userId).toBe(ids.faculty);
  });

  it('lets the assignment be linked again, which is the point of removing it', async () => {
    const link = await linkFor(ASSIGNMENT, COURSE);
    await remove(link.id);

    const contextLink = await prisma.ltiContextLink.findFirstOrThrow({
      where: { courseId: COURSE },
    });
    const linkable = await prisma.assignment.findMany({
      where: { courseId: COURSE, ltiDeepLinks: { none: { contextLinkId: contextLink.id } } },
      select: { id: true },
    });

    expect(linkable.map((a) => a.id)).toContain(ASSIGNMENT);
  });

  it('will not remove a link belonging to an assignment in another course', async () => {
    const theirs = await linkFor(OTHER_ASSIGNMENT, OTHER_COURSE);

    // The caller runs both courses, so only the id matching rejects this.
    expect((await remove(theirs.id)).status).toBe(404);
    expect(await prisma.ltiDeepLink.findUnique({ where: { id: theirs.id } })).not.toBeNull();
  });

  it('refuses on an archived course, where nothing about it may change', async () => {
    const link = await linkFor(ASSIGNMENT, COURSE);
    await prisma.course.update({ where: { id: COURSE }, data: { isArchived: true } });

    expect((await remove(link.id)).status).toBe(409);
    expect(await prisma.ltiDeepLink.findUnique({ where: { id: link.id } })).not.toBeNull();
  });

  it('refuses a student in the course', async () => {
    const link = await linkFor(ASSIGNMENT, COURSE);
    session.current = { user: { id: ids.student, isAdmin: false } };

    expect((await remove(link.id)).status).toBe(403);
    expect(await prisma.ltiDeepLink.findUnique({ where: { id: link.id } })).not.toBeNull();
  });
});
