import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';
import { findOrphanedLaunchAccount } from './jit-duplicates';

/**
 * Which launch-made accounts may have their sign-in moved, against a real Postgres.
 *
 * The whole feature rests on this predicate. Moving an LMS sign-in retires the account it came
 * from, so anything that account is holding has to be genuinely nothing: a wrong "yes" here
 * strands somebody's coursework on a deactivated account, which is worse than the duplicate it
 * is trying to fix.
 *
 * The first draft of this used "has no roster row" as the whole test. Several of the cases
 * below are the ways that was wrong, and they are here so the shorter test is not restored.
 */

const ISSUER = 'https://canvas.jit.test';
const NAME = { firstName: 'Bruce', lastName: 'Wayne' };
const ids = {
  orphan: 'u-jit-orphan',
  other: 'u-jit-other',
  course: 'c-jit',
  assignment: 'a-jit',
  problem: 'p-jit',
};

async function destroyFixtures() {
  await prisma.activityLog.deleteMany({ where: { userId: { in: [ids.orphan, ids.other] } } });
  await prisma.ltiScoreQueue.deleteMany({ where: { userId: { in: [ids.orphan, ids.other] } } });
  await prisma.comment.deleteMany({ where: { aboutStudentId: { in: [ids.orphan, ids.other] } } });
  await prisma.assignmentProblemGrade.deleteMany({
    where: { studentId: { in: [ids.orphan, ids.other] } },
  });
  await prisma.roster.deleteMany({ where: { userId: { in: [ids.orphan, ids.other] } } });
  await prisma.linkedIdentity.deleteMany({ where: { issuer: ISSUER } });
  await prisma.assignmentProblem.deleteMany({ where: { assignmentId: ids.assignment } });
  await prisma.assignment.deleteMany({ where: { id: ids.assignment } });
  await prisma.problem.deleteMany({ where: { id: ids.problem } });
  await prisma.course.deleteMany({ where: { id: ids.course } });
  await prisma.user.deleteMany({ where: { id: { in: [ids.orphan, ids.other] } } });
}

/** The account as an LMS leaves it: no password, no roster row, one just-in-time identity. */
async function makeOrphan(over: Record<string, unknown> = {}) {
  await prisma.user.create({
    data: { id: ids.orphan, email: 'bruce@lms.test', ...NAME, ...over },
  });
  await prisma.linkedIdentity.create({
    data: {
      userId: ids.orphan,
      kind: 'LTI',
      linkedVia: 'JUST_IN_TIME',
      issuer: ISSUER,
      subject: 'lms-subject-1',
    },
  });
}

async function makeCourse() {
  await prisma.course.create({
    data: {
      id: ids.course,
      name: 'Theory',
      code: 'CMPSC 464',
      semester: 'Fall 2026',
      credits: 3,
      startDate: new Date('2026-08-24T00:00:00Z'),
      endDate: new Date('2026-12-18T00:00:00Z'),
    },
  });
}

beforeEach(destroyFixtures);
afterAll(async () => {
  await destroyFixtures();
  await prisma.$disconnect();
});

describe('finding an account an LMS made and nobody used', () => {
  it('finds the plain case', async () => {
    await makeOrphan();

    const found = await findOrphanedLaunchAccount(NAME);

    expect(found?.userId).toBe(ids.orphan);
    expect(found?.email).toBe('bruce@lms.test');
    expect(found?.issuer).toBe(ISSUER);
  });

  it('matches whatever case the name was typed in', async () => {
    await makeOrphan();

    expect(
      await findOrphanedLaunchAccount({ firstName: 'bruce', lastName: 'WAYNE' }),
    ).not.toBeNull();
  });

  it('says nothing about a different name', async () => {
    await makeOrphan();

    expect(await findOrphanedLaunchAccount({ firstName: 'Clark', lastName: 'Kent' })).toBeNull();
  });

  /**
   * The one that matters most. Two real people share a name often enough, and answering with
   * either of them would retire a stranger's account on an administrator's tick.
   */
  it('says nothing when two accounts match, rather than guessing', async () => {
    await makeOrphan();
    await prisma.user.create({
      data: { id: ids.other, email: 'bruce2@lms.test', ...NAME },
    });
    await prisma.linkedIdentity.create({
      data: {
        userId: ids.other,
        kind: 'LTI',
        linkedVia: 'JUST_IN_TIME',
        issuer: ISSUER,
        subject: 'lms-subject-2',
      },
    });

    expect(await findOrphanedLaunchAccount(NAME)).toBeNull();
  });

  describe('what disqualifies an account', () => {
    it('a roster row, because somebody put them in a course', async () => {
      await makeOrphan();
      await makeCourse();
      await prisma.roster.create({
        data: { courseId: ids.course, userId: ids.orphan, role: 'STUDENT' },
      });

      expect(await findOrphanedLaunchAccount(NAME)).toBeNull();
    });

    /**
     * Removing somebody from a roster is a hard delete and refuses only on submissions, and a
     * hand-entered grade is written against the student with no submission behind it. So this
     * is a real account with no roster row and real marks on it.
     */
    it('a grade, even with no roster row and no submission', async () => {
      await makeOrphan();
      await makeCourse();
      await prisma.problem.create({
        data: { id: ids.problem, courseId: ids.course, title: 'FA', type: 'FA' },
      });
      await prisma.assignment.create({
        data: {
          id: ids.assignment,
          courseId: ids.course,
          title: 'Problem set',
          dueDate: new Date('2026-10-01T00:00:00Z'),
        },
      });
      await prisma.assignmentProblem.create({
        data: { assignmentId: ids.assignment, problemId: ids.problem, maxPoints: 10 },
      });
      await prisma.assignmentProblemGrade.create({
        data: {
          assignmentId: ids.assignment,
          problemId: ids.problem,
          studentId: ids.orphan,
          grade: 8,
          gradedManually: true,
          gradeSource: 'MANUAL',
        },
      });

      expect(await findOrphanedLaunchAccount(NAME)).toBeNull();
    });

    it('a password, because they have made the account their own', async () => {
      await makeOrphan({ password: 'hashed' });

      expect(await findOrphanedLaunchAccount(NAME)).toBeNull();
    });

    it('being an administrator, who can act in a course with no roster row', async () => {
      await makeOrphan({ isAdmin: true });

      expect(await findOrphanedLaunchAccount(NAME)).toBeNull();
    });

    it('already being deactivated', async () => {
      await makeOrphan({ inactive: true });

      expect(await findOrphanedLaunchAccount(NAME)).toBeNull();
    });

    /**
     * A second sign-in would be stranded on the retired account, so its owner would meet a dead
     * end rather than the new account.
     */
    it('a second sign-in method', async () => {
      await makeOrphan();
      await prisma.linkedIdentity.create({
        data: {
          userId: ids.orphan,
          kind: 'OIDC',
          linkedVia: 'AUTO_VERIFIED_EMAIL',
          issuer: ISSUER,
          subject: 'oidc-subject-1',
        },
      });

      expect(await findOrphanedLaunchAccount(NAME)).toBeNull();
    });

    it('a sign-in an administrator or the person themselves attached', async () => {
      await prisma.user.create({
        data: { id: ids.orphan, email: 'bruce@lms.test', ...NAME },
      });
      await prisma.linkedIdentity.create({
        data: {
          userId: ids.orphan,
          kind: 'LTI',
          linkedVia: 'SELF_SERVICE',
          issuer: ISSUER,
          subject: 'lms-subject-1',
        },
      });

      expect(await findOrphanedLaunchAccount(NAME)).toBeNull();
    });

    it('an account with no sign-in from an LMS at all', async () => {
      await prisma.user.create({
        data: { id: ids.orphan, email: 'bruce@lms.test', ...NAME },
      });

      expect(await findOrphanedLaunchAccount(NAME)).toBeNull();
    });
  });
});
