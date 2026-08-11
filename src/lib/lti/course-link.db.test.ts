import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';
import {
  mapLtiRoles,
  resolveLaunchTarget,
  linkLaunchCourse,
  enrolFromLaunch,
  purgeExpiredPendingLinks,
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
  membershipsUrl: null,
  ...over,
});

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
});

afterAll(async () => {
  await destroyFixtures();
  await prisma.$disconnect();
});

describe('mapping LTI roles', () => {
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

  // Course staff for reading, not for configuration.
  it('does not offer the choice to a TA', async () => {
    const target = await resolveLaunchTarget({ identity: identity(), userId: ids.ta });

    expect(target).toEqual({ status: 'not-set-up' });
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

  it('refuses a TA on that course', async () => {
    const result = await linkLaunchCourse({
      identity: identity(),
      courseId: COURSE,
      userId: ids.ta,
      context: CTX,
    });

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
