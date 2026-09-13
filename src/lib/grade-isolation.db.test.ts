import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';

/**
 * A group grade and an individual grade for the same problem, at the same moment.
 *
 * The group route refuses to flatten a member's individual adjustment: it reads every member's
 * grade, reports anything that differs, and writes only once the grader confirms with
 * `overwrite`. Holding those rows with `FOR UPDATE` makes that true for members who already
 * have a grade. It cannot do anything for a member who has none, because there is no row to
 * lock, and that is the case this file is about: an individual grade arriving for a member who
 * had nothing, in the window between the group's read and its write.
 *
 * The group transaction being Serializable is what closes it, and the group side alone: its
 * read of the members' rows saw no row for that member, and a row for them appears before it
 * writes, which is an anomaly its own snapshot can detect. The other side's isolation level
 * makes no difference, which is worth saying because the obvious guess is that both have to be
 * serializable for anything to conflict. The second case below is what establishes that: the
 * individual grade runs at READ COMMITTED and the conflict is still refused.
 *
 * Dropping the group side to READ COMMITTED is what brings the overwrite back, which is the
 * only removal that proves which half is load-bearing.
 */

const SUFFIX = 'gradeiso';
const ids = {
  grader: `u-${SUFFIX}-grader`,
  alice: `u-${SUFFIX}-alice`,
  bob: `u-${SUFFIX}-bob`,
  course: `c-${SUFFIX}`,
  assignment: `a-${SUFFIX}`,
  problem: `p-${SUFFIX}`,
};

async function destroyFixtures() {
  await prisma.assignmentProblemGrade.deleteMany({ where: { assignmentId: ids.assignment } });
  await prisma.assignmentProblem.deleteMany({ where: { assignmentId: ids.assignment } });
  await prisma.assignment.deleteMany({ where: { id: ids.assignment } });
  await prisma.problem.deleteMany({ where: { id: ids.problem } });
  await prisma.roster.deleteMany({ where: { courseId: ids.course } });
  await prisma.course.deleteMany({ where: { id: ids.course } });
  await prisma.user.deleteMany({ where: { id: { in: [ids.grader, ids.alice, ids.bob] } } });
}

async function seedFixtures() {
  await prisma.user.createMany({
    data: [ids.grader, ids.alice, ids.bob].map((id) => ({
      id,
      email: `${id}@example.test`,
      password: null,
    })),
  });
  await prisma.course.create({
    data: {
      id: ids.course,
      name: 'Grade Isolation',
      code: `GI ${Math.floor(Math.random() * 900 + 100)}`,
      semester: 'Fall 2026',
      credits: 3,
      startDate: new Date('2026-08-24T00:00:00Z'),
      endDate: new Date('2026-12-18T00:00:00Z'),
    },
  });
  await prisma.assignment.create({
    data: {
      id: ids.assignment,
      courseId: ids.course,
      title: 'Group work',
      dueDate: new Date('2026-09-01T00:00:00Z'),
    },
  });
  await prisma.problem.create({
    data: { id: ids.problem, courseId: ids.course, title: 'Q1', type: 'FA' },
  });
  await prisma.assignmentProblem.create({
    data: { assignmentId: ids.assignment, problemId: ids.problem, maxPoints: 10 },
  });
}

beforeEach(async () => {
  await destroyFixtures();
  await seedFixtures();
});

afterAll(async () => {
  await destroyFixtures();
  await prisma.$disconnect();
});

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const gradeOf = async (studentId: string) =>
  (
    await prisma.assignmentProblemGrade.findFirst({
      where: { assignmentId: ids.assignment, problemId: ids.problem, studentId },
      select: { grade: true },
    })
  )?.grade ?? null;

/** The group route's shape: read every member's grade, then write all of them. */
function gradeTheGroup(
  value: number,
  opts: { pauseMs: number; isolation?: Prisma.TransactionIsolationLevel },
) {
  return prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`
        SELECT g."studentId", g."grade"
        FROM "AssignmentProblemGrade" g
        WHERE g."assignmentId" = ${ids.assignment}
          AND g."problemId" = ${ids.problem}
          AND g."studentId" = ANY(${[ids.alice, ids.bob]})
        FOR UPDATE OF g
      `;

      // The window an individual grade can land in.
      await wait(opts.pauseMs);

      for (const studentId of [ids.alice, ids.bob]) {
        await tx.assignmentProblemGrade.upsert({
          where: {
            assignmentId_problemId_studentId: {
              assignmentId: ids.assignment,
              problemId: ids.problem,
              studentId,
            },
          },
          create: {
            assignmentId: ids.assignment,
            problemId: ids.problem,
            studentId,
            grade: value,
            gradedManually: true,
            gradeSource: 'MANUAL',
          },
          update: { grade: value, gradedManually: true, gradeSource: 'MANUAL' },
        });
      }
    },
    {
      isolationLevel: opts.isolation ?? Prisma.TransactionIsolationLevel.Serializable,
      timeout: 20_000,
    },
  );
}

/** The single-student route's shape: write one member's grade. */
function gradeOneStudent(
  studentId: string,
  value: number,
  opts: { isolation?: Prisma.TransactionIsolationLevel } = {},
) {
  return prisma.$transaction(
    async (tx) => {
      await tx.assignmentProblemGrade.upsert({
        where: {
          assignmentId_problemId_studentId: {
            assignmentId: ids.assignment,
            problemId: ids.problem,
            studentId,
          },
        },
        create: {
          assignmentId: ids.assignment,
          problemId: ids.problem,
          studentId,
          grade: value,
          gradedManually: true,
          gradeSource: 'MANUAL',
        },
        update: { grade: value, gradedManually: true, gradeSource: 'MANUAL' },
      });
    },
    {
      isolationLevel: opts.isolation ?? Prisma.TransactionIsolationLevel.Serializable,
      timeout: 20_000,
    },
  );
}

const isSerializationFailure = (err: unknown) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034';

describe('an individual grade arriving while a group grade is in flight', () => {
  it('refuses one of them when the member had no grade to lock', async () => {
    // Bob has nothing, so `FOR UPDATE` has no row of his to hold: the group's read matches no
    // row for him, and a lock cannot be taken on something that is not there. Isolation is the
    // only thing standing between his new individual mark and the group's write.
    const group = gradeTheGroup(5, { pauseMs: 400 });
    await wait(150);
    const individual = gradeOneStudent(ids.bob, 9);

    const results = await Promise.allSettled([group, individual]);
    const failures = results.filter((r) => r.status === 'rejected');

    expect(failures).toHaveLength(1);
    expect(isSerializationFailure((failures[0] as PromiseRejectedResult).reason)).toBe(true);

    // Whichever survived, Bob is not left holding a number neither grader decided: either the
    // group's 5 (the individual was refused, and the grader is told to try again) or his own 9
    // (the group was refused, and the conflict it exists to raise is still ahead of them).
    expect([5, 9]).toContain(await gradeOf(ids.bob));
  });

  /**
   * The same interleaving with the individual grade at READ COMMITTED, where it still is.
   *
   * Still refused. The group side carries this on its own, so the single-student route was left
   * alone: making it serializable too would buy nothing here and cost real aborts between two
   * graders marking different students on the same problem.
   */
  it('is refused whatever isolation the individual grade runs at', async () => {
    const group = gradeTheGroup(5, { pauseMs: 400 });
    await wait(150);
    const individual = gradeOneStudent(ids.bob, 9, {
      isolation: Prisma.TransactionIsolationLevel.ReadCommitted,
    });

    const results = await Promise.allSettled([group, individual]);

    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
  });

  /**
   * And the removal that says which half matters.
   *
   * With the group side at READ COMMITTED nothing is refused, and Bob's individual 9 is quietly
   * flattened to the group's 5 with nobody told. That is the bug, reproduced.
   */
  it('flattens the individual grade when the group side is not serializable', async () => {
    const group = gradeTheGroup(5, {
      pauseMs: 400,
      isolation: Prisma.TransactionIsolationLevel.ReadCommitted,
    });
    await wait(150);
    const individual = gradeOneStudent(ids.bob, 9, {
      isolation: Prisma.TransactionIsolationLevel.ReadCommitted,
    });

    const results = await Promise.allSettled([group, individual]);

    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(0);
    expect(await gradeOf(ids.bob)).toBe(5);
  });
});
