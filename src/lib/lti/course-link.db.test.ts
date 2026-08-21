import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';
import {
  mapLtiRoles,
  resolveLaunchTarget,
  linkLaunchCourse,
  enrolFromLaunch,
  purgeExpiredPendingLinks,
  rememberContextMember,
} from './course-link';
import type { LaunchIdentity } from './launch';

/**
 * Landing a launch in the right course, against a real Postgres.
 *
 * The rule that carries the weight is who may link. Without it, a launch is a way to attach a
 * course you do not own and then read its grades.
 */

const ISSUER = 'https://canvas.example.test';
const PLATFORM = 'ltip-courselink';
const ids = {
  faculty: 'u-cl-faculty',
  otherFaculty: 'u-cl-other',
  ta: 'u-cl-ta',
  student: 'u-cl-student',
  admin: 'u-cl-admin',
};
const COURSE = 'c-cl-1';
const OTHER_COURSE = 'c-cl-2';
const ASSIGNMENT = 'a-cl-1';

const R = 'http://purl.imsglobal.org/vocab/lis/v2/membership';
const CTX = { ipAddress: '10.0.0.1', userAgent: 'test' };

const identity = (over: Partial<LaunchIdentity> = {}): LaunchIdentity => ({
  platformId: PLATFORM,
  issuer: ISSUER,
  subject: 'lms-user-1',
  email: 'student@example.test',
  firstName: null,
  lastName: null,
  roles: [`${R}#Learner`],
  contextId: 'ctx-1',
  contextTitle: 'Theory of Computation',
  resourceLinkId: 'rl-1',
  targetLinkUri: null,
  lineItemsUrl: null,
  lineItemUrl: null,
  membershipsUrl: null,
  deepLink: null,
  assignmentId: null,
  ...over,
});

async function destroyFixtures() {
  await prisma.ltiPendingLink.deleteMany({ where: { platformId: PLATFORM } });
  await prisma.ltiDeepLink.deleteMany({ where: { assignmentId: ASSIGNMENT } });
  await prisma.ltiContextLink.deleteMany({ where: { platformId: PLATFORM } });
  await prisma.assignment.deleteMany({ where: { id: ASSIGNMENT } });
  await prisma.roster.deleteMany({ where: { courseId: { in: [COURSE, OTHER_COURSE] } } });
  await prisma.ltiPlatform.deleteMany({ where: { id: PLATFORM } });
  await prisma.course.deleteMany({ where: { id: { in: [COURSE, OTHER_COURSE] } } });
  await prisma.user.deleteMany({ where: { id: { in: Object.values(ids) } } });
}

beforeEach(async () => {
  await destroyFixtures();
  await prisma.user.createMany({
    data: [
      { id: ids.faculty, email: 'cl-faculty@example.test', password: 'x' },
      { id: ids.otherFaculty, email: 'cl-other@example.test', password: 'x' },
      { id: ids.ta, email: 'cl-ta@example.test', password: 'x' },
      { id: ids.student, email: 'cl-student@example.test', password: 'x' },
      { id: ids.admin, email: 'cl-admin@example.test', password: 'x', isAdmin: true },
    ],
  });
  const courseDefaults = {
    code: 'CMPSC 464',
    semester: 'Fall 2026',
    credits: 3,
    startDate: new Date('2026-08-24T00:00:00Z'),
    endDate: new Date('2026-12-18T00:00:00Z'),
  };
  await prisma.course.createMany({
    data: [
      { id: COURSE, name: 'Theory of Computation', ...courseDefaults },
      { id: OTHER_COURSE, name: 'Somebody else’s course', ...courseDefaults },
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
      { courseId: COURSE, userId: ids.ta, role: 'TA' },
      { courseId: OTHER_COURSE, userId: ids.otherFaculty, role: 'FACULTY' },
    ],
  });
  await prisma.assignment.create({
    data: {
      id: ASSIGNMENT,
      courseId: COURSE,
      title: 'Regular languages',
      dueDate: new Date('2026-10-01T00:00:00Z'),
      isPublished: true,
    },
  });
});

afterAll(async () => {
  await destroyFixtures();
  await prisma.$disconnect();
});

describe('mapping LTI roles', () => {
  /**
   * The vocabulary spells one role several ways, and an unrecognised spelling silently became
   * STUDENT: an instructor whose platform sends the legacy URI would have been enrolled as one
   * of their own students.
   */
  it('reads the spellings a platform may actually send', () => {
    expect(mapLtiRoles(['urn:lti:role:ims/lis/Instructor'])).toBe('FACULTY');
    expect(
      mapLtiRoles(['http://purl.imsglobal.org/vocab/lis/v2/institution/person#Instructor']),
    ).toBe('FACULTY');
    expect(
      mapLtiRoles([
        'http://purl.imsglobal.org/vocab/lis/v2/membership/Instructor#TeachingAssistant',
      ]),
    ).toBe('TA');
  });

  /** Least privilege for anything unknown, and for the roles that watch rather than teach. */
  it('does not promote a role it does not know', () => {
    expect(mapLtiRoles(['http://purl.imsglobal.org/vocab/lis/v2/membership#Mentor'])).toBe(
      'STUDENT',
    );
    expect(mapLtiRoles(['something-nobody-has-defined'])).toBe('STUDENT');
    expect(mapLtiRoles([])).toBe('STUDENT');
  });

  it('reads the usual ones', () => {
    expect(mapLtiRoles([`${R}#Instructor`])).toBe('FACULTY');
    expect(mapLtiRoles([`${R}#TeachingAssistant`])).toBe('TA');
    expect(mapLtiRoles([`${R}#Learner`])).toBe('STUDENT');
  });

  // Happens in sandboxes and cross-listed sections. Demoting an instructor would be worse than
  // the reverse, and the reverse is not on offer here.
  it('gives the most privileged role when somebody has several', () => {
    expect(mapLtiRoles([`${R}#Learner`, `${R}#Instructor`])).toBe('FACULTY');
    expect(mapLtiRoles([`${R}#Learner`, `${R}#TeachingAssistant`])).toBe('TA');
  });

  // The only safe guess for a vocabulary we do not know.
  it('treats anything unrecognised as a student', () => {
    expect(mapLtiRoles(['http://example.test/vocab#Wizard'])).toBe('STUDENT');
    expect(mapLtiRoles([])).toBe('STUDENT');
  });
});

describe('where a launch lands', () => {
  it('goes to the linked course once somebody has linked it', async () => {
    await linkLaunchCourse({
      identity: identity(),
      courseId: COURSE,
      userId: ids.faculty,
      context: CTX,
    });

    const target = await resolveLaunchTarget({ identity: identity(), userId: ids.student });

    expect(target).toEqual({ status: 'linked', courseId: COURSE });
  });

  it('asks faculty to choose when it is not linked yet', async () => {
    const target = await resolveLaunchTarget({ identity: identity(), userId: ids.faculty });

    expect(target).toEqual({ status: 'needs-link' });
  });

  /**
   * A student must never be offered the choice. They would be picking which course their own
   * work counts towards.
   */
  it('tells a student it is not set up rather than offering the choice', async () => {
    const target = await resolveLaunchTarget({ identity: identity(), userId: ids.student });

    expect(target).toEqual({ status: 'not-set-up' });
  });

  /**
   * TAs may link. They are often the ones setting a course up, and a TA already reads and
   * grades everything in their course, so the LMS connection is not a new power. Which course
   * they may attach it to is still checked per course, below.
   */
  it('offers the choice to a TA', async () => {
    const target = await resolveLaunchTarget({ identity: identity(), userId: ids.ta });

    expect(target).toEqual({ status: 'needs-link' });
  });

  it('offers the choice to an admin who runs no courses', async () => {
    const target = await resolveLaunchTarget({ identity: identity(), userId: ids.admin });

    expect(target).toEqual({ status: 'needs-link' });
  });

  it('has nothing to link when the launch carried no course', async () => {
    const target = await resolveLaunchTarget({
      identity: identity({ contextId: null }),
      userId: ids.faculty,
    });

    expect(target).toEqual({ status: 'no-context' });
  });
});

describe('who may link a course', () => {
  it('lets the faculty who run it', async () => {
    const result = await linkLaunchCourse({
      identity: identity(),
      courseId: COURSE,
      userId: ids.faculty,
      context: CTX,
    });

    expect(result).toEqual({ ok: true });
  });

  /**
   * The rule that matters. Running one course must not let somebody attach an LMS course to a
   * different one, which would hand them its grades.
   */
  it('refuses faculty attaching it to a course they do not run', async () => {
    const result = await linkLaunchCourse({
      identity: identity(),
      courseId: COURSE,
      userId: ids.otherFaculty,
      context: CTX,
    });

    expect(result).toEqual({ ok: false, reason: 'not-allowed' });
    expect(await prisma.ltiContextLink.count()).toBe(0);
  });

  it('allows a TA on that course', async () => {
    const result = await linkLaunchCourse({
      identity: identity(),
      courseId: COURSE,
      userId: ids.ta,
      context: CTX,
    });

    expect(result).toEqual({ ok: true });
  });

  /**
   * Being staff somewhere is not being staff here. The check is on this course, or a TA could
   * point their LMS course at somebody else's and collect its grades.
   */
  it('refuses a TA of another course', async () => {
    const elsewhere = await prisma.course.create({
      data: {
        name: 'Not theirs',
        code: 'CMPSC 111',
        semester: 'Fall 2026',
        credits: 3,
        startDate: new Date('2026-08-24T00:00:00Z'),
        endDate: new Date('2026-12-18T00:00:00Z'),
      },
    });

    const result = await linkLaunchCourse({
      identity: identity(),
      courseId: elsewhere.id,
      userId: ids.ta,
      context: CTX,
    });

    await prisma.course.delete({ where: { id: elsewhere.id } });

    expect(result).toEqual({ ok: false, reason: 'not-allowed' });
  });

  it('refuses a student', async () => {
    const result = await linkLaunchCourse({
      identity: identity(),
      courseId: COURSE,
      userId: ids.student,
      context: CTX,
    });

    expect(result).toEqual({ ok: false, reason: 'not-allowed' });
  });

  it('lets an admin link any course', async () => {
    const result = await linkLaunchCourse({
      identity: identity(),
      courseId: OTHER_COURSE,
      userId: ids.admin,
      context: CTX,
    });

    expect(result).toEqual({ ok: true });
  });
});

describe('what may be linked to what', () => {
  /**
   * Cross-listed sections are separate LMS courses and one course to the department. Forcing
   * them apart would split one roster in two.
   */
  it('lets two LMS courses open the same AFCT course', async () => {
    await linkLaunchCourse({
      identity: identity(),
      courseId: COURSE,
      userId: ids.faculty,
      context: CTX,
    });

    const second = await linkLaunchCourse({
      identity: identity({ contextId: 'ctx-2' }),
      courseId: COURSE,
      userId: ids.faculty,
      context: CTX,
    });

    expect(second).toEqual({ ok: true });
  });

  // There is no answer to "which one did they mean".
  it('refuses one LMS course opening two AFCT courses', async () => {
    await linkLaunchCourse({
      identity: identity(),
      courseId: COURSE,
      userId: ids.admin,
      context: CTX,
    });

    const second = await linkLaunchCourse({
      identity: identity(),
      courseId: OTHER_COURSE,
      userId: ids.admin,
      context: CTX,
    });

    expect(second).toEqual({ ok: false, reason: 'already-linked' });
  });
});

describe('enrolling from a launch', () => {
  it('adds somebody who is not on the roster', async () => {
    const result = await enrolFromLaunch({
      courseId: COURSE,
      userId: ids.student,
      roles: [`${R}#Learner`],
    });

    expect(result).toEqual({ created: true, role: 'STUDENT' });
  });

  /**
   * A later launch must never change a role. AFCT is the record of who runs a course, and an
   * LMS role change should not silently demote somebody mid-term.
   */
  it('leaves an existing role alone', async () => {
    const result = await enrolFromLaunch({
      courseId: COURSE,
      userId: ids.faculty,
      roles: [`${R}#Learner`],
    });

    expect(result).toEqual({ created: false, role: 'FACULTY' });
    const row = await prisma.roster.findFirstOrThrow({
      where: { courseId: COURSE, userId: ids.faculty },
    });
    expect(row.role).toBe('FACULTY');
  });

  // Re-enrolling is a decision for somebody in AFCT, not a side effect of opening a link.
  it('does not revive a student who dropped', async () => {
    await prisma.roster.create({
      data: { courseId: COURSE, userId: ids.student, role: 'STUDENT', status: 'DROPPED' },
    });

    await enrolFromLaunch({ courseId: COURSE, userId: ids.student, roles: [`${R}#Learner`] });

    const row = await prisma.roster.findFirstOrThrow({
      where: { courseId: COURSE, userId: ids.student },
    });
    expect(row.status).toBe('DROPPED');
  });

  it('creates an instructor as faculty', async () => {
    const result = await enrolFromLaunch({
      courseId: COURSE,
      userId: ids.student,
      roles: [`${R}#Instructor`],
    });

    expect(result).toEqual({ created: true, role: 'FACULTY' });
  });

  /**
   * A row that is already there when the launch looks, which returns before any insert is
   * attempted. The branch behind the unique-constraint catch cannot be reached on demand
   * against a real database, so it is driven with mocks in `course-link-races.test.ts`.
   */
  it('keeps the role on a row that already exists, without attempting an insert', async () => {
    await prisma.roster.create({ data: { courseId: COURSE, userId: ids.student, role: 'TA' } });

    const result = await enrolFromLaunch({
      courseId: COURSE,
      userId: ids.student,
      roles: [`${R}#Learner`],
    });

    // The existing role stands: an LMS role must not quietly demote somebody mid-term.
    expect(result).toEqual({ created: false, role: 'TA' });
  });

  /**
   * Everything else must travel. The catch used to swallow any failure and answer with a role
   * nobody had written, so a launch went on to open a course the person was not enrolled in.
   */
  it('lets a failure that is not the race travel, as itself', async () => {
    // A foreign key that does not hold, which the catch must not read as "somebody got here
    // first". Asserting the code rather than merely that it threw: a broad catch followed by a
    // missing-row check would also throw, and would hide what actually happened.
    await expect(
      enrolFromLaunch({
        courseId: 'no-such-course',
        userId: ids.student,
        roles: [`${R}#Learner`],
      }),
    ).rejects.toMatchObject({ code: 'P2003' });

    expect(await prisma.roster.count({ where: { userId: ids.student } })).toBe(0);
  });
});

/**
 * A launch from an unlinked course leaves a pending link behind whenever somebody closes the
 * tab instead of choosing. Nothing depends on them surviving, but without a sweep they
 * accumulate for ever.
 */
describe('sweeping pending links', () => {
  const pending = (id: string, expiresAt: Date) =>
    prisma.ltiPendingLink.create({
      data: {
        id,
        platformId: PLATFORM,
        contextId: 'ctx-1',
        userId: ids.faculty,
        expiresAt,
      },
    });

  it('deletes ones that have expired', async () => {
    await pending('pl-old', new Date(Date.now() - 1000));

    expect(await purgeExpiredPendingLinks()).toBe(1);
    expect(await prisma.ltiPendingLink.count()).toBe(0);
  });

  // Somebody may be reading the picker right now.
  it('leaves ones still in their window alone', async () => {
    await pending('pl-live', new Date(Date.now() + 60_000));

    expect(await purgeExpiredPendingLinks()).toBe(0);
    expect(await prisma.ltiPendingLink.count()).toBe(1);
  });
});

/**
 * Bookkeeping that must never cost somebody their launch.
 *
 * `rememberContextMember` records which LMS course a person came through, so a grade can later be
 * sent to the right gradebook. It is written on every launch, and it is deliberately best effort:
 * the worst case if it fails is a grade that cannot be placed later, and that reports itself. A
 * launch that failed instead would lock a student out of their course at the moment they clicked
 * a link in their LMS.
 *
 * The guard was there and nothing exercised it, which is the same state the similarity report was
 * in when it turned out to be failing graded submissions. A guard nobody tests is a guard the next
 * person can delete without anything going red.
 *
 * These reach it directly. Forcing the write to fail *underneath a real launch* would need the
 * context link to exist for the lookup and not for the upsert, which cannot be arranged against a
 * real database without mocking the client, and a test that mocked it would prove the mock. So the
 * guard is proven here and the launch path is left to the tests above it.
 */
describe('recording which LMS course somebody came through', () => {
  /** A membership write that cannot succeed: the context link it points at does not exist. */
  const doomed = () =>
    rememberContextMember({
      contextLinkId: 'a-context-link-that-does-not-exist',
      userId: ids.student,
      ltiUserId: 'lms-user-1',
    });

  it('swallows a write it cannot make', async () => {
    await expect(doomed()).resolves.toBeUndefined();
  });

  it('records nothing when it fails', async () => {
    await doomed();

    expect(await prisma.ltiContextMember.count({ where: { userId: ids.student } })).toBe(0);
  });

  // The ordinary path still writes the row, so the guard is not hiding a broken feature.
  it('records the membership when it can', async () => {
    await linkLaunchCourse({
      identity: identity(),
      courseId: COURSE,
      userId: ids.faculty,
      context: CTX,
    });

    await resolveLaunchTarget({ identity: identity(), userId: ids.student });

    const member = await prisma.ltiContextMember.findFirst({ where: { userId: ids.student } });
    expect(member?.ltiUserId).toBe(identity().subject);
  });
});

/**
 * Confirming that the LMS really kept a link, which is the half of #697 the Remove button did
 * not solve.
 *
 * AFCT writes the `LtiDeepLink` row when it hands the signed response to the browser and hears
 * nothing afterwards, so a platform that refuses the response leaves a row nothing can open.
 * A launch arriving through the link is the only evidence there is.
 */
describe('confirming a deep link on launch', () => {
  const linked = () =>
    linkLaunchCourse({ identity: identity(), courseId: COURSE, userId: ids.faculty, context: CTX });

  const deepLink = async () => {
    const contextLink = await prisma.ltiContextLink.findFirstOrThrow({
      where: { platformId: PLATFORM },
    });
    return prisma.ltiDeepLink.create({
      data: { contextLinkId: contextLink.id, assignmentId: ASSIGNMENT },
    });
  };

  const launch = (over: Partial<LaunchIdentity> = {}) =>
    resolveLaunchTarget({ identity: identity({ assignmentId: ASSIGNMENT, ...over }), userId: ids.student });

  const reread = (id: string) => prisma.ltiDeepLink.findUniqueOrThrow({ where: { id } });

  it('marks the link the launch came through', async () => {
    await linked();
    const link = await deepLink();
    expect(link.confirmedAt).toBeNull();

    await launch();

    expect((await reread(link.id)).confirmedAt).toBeInstanceOf(Date);
  });

  /** The first launch is the one that proves it, so a later one must not move the date. */
  it('keeps the first launch, not the most recent', async () => {
    await linked();
    const link = await deepLink();

    await launch();
    const first = (await reread(link.id)).confirmedAt;
    await launch();

    expect((await reread(link.id)).confirmedAt).toEqual(first);
  });

  /**
   * The claim travels through the platform and could name anything. A launch must only ever
   * confirm a link the picker already wrote, never invent one.
   */
  it('creates nothing when there is no link to confirm', async () => {
    await linked();

    await launch();

    expect(await prisma.ltiDeepLink.count({ where: { assignmentId: ASSIGNMENT } })).toBe(0);
  });

  it('leaves a link alone when the launch names no assignment', async () => {
    await linked();
    const link = await deepLink();

    await resolveLaunchTarget({ identity: identity(), userId: ids.student });

    expect((await reread(link.id)).confirmedAt).toBeNull();
  });

  /**
   * Two LMS courses can open the same AFCT course, and each has its own link. Confirming by
   * assignment alone would let a launch in one vouch for a link in the other.
   */
  it('does not confirm a link belonging to another LMS course', async () => {
    await linked();
    const link = await deepLink();

    const otherContext = await prisma.ltiContextLink.create({
      data: { platformId: PLATFORM, contextId: 'ctx-2', courseId: COURSE },
    });
    const otherLink = await prisma.ltiDeepLink.create({
      data: { contextLinkId: otherContext.id, assignmentId: ASSIGNMENT },
    });

    await launch();

    expect((await reread(link.id)).confirmedAt).toBeInstanceOf(Date);
    expect((await reread(otherLink.id)).confirmedAt).toBeNull();
  });
});
