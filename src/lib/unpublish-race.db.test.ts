import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';
import { lockAssignmentWork, unpublishBlockedBy } from '@/lib/course-status-checks';
import { lockSubmissionRows } from '@/lib/submission-eligibility';

/**
 * Unpublishing an assignment while a student is handing work in.
 *
 * The rule is that an assignment students have submitted to, or that carries marks, stays
 * published: unpublishing hides it, and hidden work is work nobody can see. The guard used to
 * read the counts through `prisma` and then update in a separate statement, holding nothing in
 * between, so the two could pass each other and leave exactly the state the rule forbids.
 *
 * Both sides now take the same rows. These run them against a real Postgres in both orders,
 * because what is being tested is row locking and transaction ordering, and a mocked client
 * would agree with whichever answer the code happened to produce.
 *
 * The submission side here is a stand-in, not `createSubmission`: it takes the same lock
 * through the same helper, re-reads `isPublished` under it and inserts, which is the part that
 * races. What `createSubmission` does with a `false` re-read is settled by its own unit test
 * ("refuses once the assignment has been unpublished") and is not what these are about.
 */

const SUFFIX = 'unpubrace';
const ids = {
  user: `u-${SUFFIX}`,
  course: `c-${SUFFIX}`,
  assignment: `a-${SUFFIX}`,
  problem: `p-${SUFFIX}`,
};

async function destroyFixtures() {
  await prisma.submission.deleteMany({ where: { courseId: ids.course } });
  await prisma.assignmentProblemGrade.deleteMany({ where: { assignmentId: ids.assignment } });
  await prisma.assignmentProblem.deleteMany({ where: { assignmentId: ids.assignment } });
  await prisma.assignment.deleteMany({ where: { id: ids.assignment } });
  await prisma.problem.deleteMany({ where: { id: ids.problem } });
  await prisma.roster.deleteMany({ where: { courseId: ids.course } });
  await prisma.course.deleteMany({ where: { id: ids.course } });
  await prisma.user.deleteMany({ where: { id: ids.user } });
}

async function seedFixtures() {
  await prisma.user.create({
    data: { id: ids.user, email: `${ids.user}@example.test`, password: null },
  });
  await prisma.course.create({
    data: {
      id: ids.course,
      name: 'Unpublish Race',
      code: `UR ${Math.floor(Math.random() * 900 + 100)}`,
      semester: 'Fall 2026',
      credits: 3,
      startDate: new Date('2026-08-24T00:00:00Z'),
      endDate: new Date('2026-12-18T00:00:00Z'),
    },
  });
  await prisma.roster.create({
    data: { courseId: ids.course, userId: ids.user, role: 'STUDENT' },
  });
  await prisma.assignment.create({
    data: {
      id: ids.assignment,
      courseId: ids.course,
      title: 'Homework 1',
      dueDate: new Date('2026-09-01T00:00:00Z'),
      isPublished: true,
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

class UnpublishRefused extends Error {
  constructor(readonly kind: 'submissions' | 'grades') {
    super(kind);
  }
}

/** What the route's handlers do: lock, ask, then write, all in one transaction. */
function unpublish(opts: { pauseMs: number }) {
  return prisma.$transaction(
    async (tx) => {
      await lockAssignmentWork(tx, ids.assignment);
      await wait(opts.pauseMs);

      const blockedBy = await unpublishBlockedBy(tx, ids.assignment);
      if (blockedBy) throw new UnpublishRefused(blockedBy);

      await tx.assignment.update({ where: { id: ids.assignment }, data: { isPublished: false } });
      return 'unpublished' as const;
    },
    { timeout: 20_000 },
  );
}

/** The shape of the submission path: the same lock, then the re-read, then the insert. */
function submit(opts: { pauseMs: number }) {
  return prisma.$transaction(
    async (tx) => {
      await lockSubmissionRows(tx, {
        assignmentId: ids.assignment,
        problemId: ids.problem,
        groupSetId: null,
      });
      await wait(opts.pauseMs);

      const fresh = await tx.assignment.findUniqueOrThrow({
        where: { id: ids.assignment },
        select: { isPublished: true },
      });
      if (!fresh.isPublished) return 'refused' as const;

      await tx.submission.create({
        data: {
          courseId: ids.course,
          assignmentId: ids.assignment,
          problemId: ids.problem,
          studentId: ids.user,
          status: 'PENDING',
        },
      });
      return 'accepted' as const;
    },
    { timeout: 20_000 },
  );
}

const submissionCount = () => prisma.submission.count({ where: { assignmentId: ids.assignment } });
const isPublished = async () =>
  (
    await prisma.assignment.findUniqueOrThrow({
      where: { id: ids.assignment },
      select: { isPublished: true },
    })
  ).isPublished;

describe('unpublishing while a submission is in flight', () => {
  it('refuses the submission when the unpublish gets the rows first', async () => {
    const unpublishing = unpublish({ pauseMs: 300 });
    await wait(100);
    const submitting = submit({ pauseMs: 0 });

    expect(await unpublishing).toBe('unpublished');
    // It waited on the rows, then read the assignment as it actually is rather than as it was
    // when the request started.
    expect(await submitting).toBe('refused');

    expect(await isPublished()).toBe(false);
    expect(await submissionCount()).toBe(0);
  });

  it('refuses the unpublish when the submission gets the rows first', async () => {
    const submitting = submit({ pauseMs: 300 });
    await wait(100);
    const unpublishing = unpublish({ pauseMs: 0 });

    expect(await submitting).toBe('accepted');
    await expect(unpublishing).rejects.toBeInstanceOf(UnpublishRefused);

    // The work exists and the assignment students handed it in against is still published.
    expect(await isPublished()).toBe(true);
    expect(await submissionCount()).toBe(1);
  });
});

describe('unpublishing an assignment that already carries work', () => {
  it('refuses when a submission exists', async () => {
    await prisma.submission.create({
      data: {
        courseId: ids.course,
        assignmentId: ids.assignment,
        problemId: ids.problem,
        studentId: ids.user,
        status: 'PENDING',
      },
    });

    await expect(unpublish({ pauseMs: 0 })).rejects.toMatchObject({ kind: 'submissions' });
    expect(await isPublished()).toBe(true);
  });

  /**
   * A grade with no submission behind it is an ordinary thing here: staff can enter one by
   * hand for work handed in on paper, or for a student the autograder never saw. It is still
   * a mark on a record, so it blocks an unpublish the same way.
   */
  it('refuses when only a grade exists', async () => {
    await prisma.assignmentProblemGrade.create({
      data: {
        assignmentId: ids.assignment,
        problemId: ids.problem,
        studentId: ids.user,
        grade: 8,
      },
    });

    await expect(unpublish({ pauseMs: 0 })).rejects.toMatchObject({ kind: 'grades' });
    expect(await isPublished()).toBe(true);
  });

  it('allows it when there is neither', async () => {
    expect(await unpublish({ pauseMs: 0 })).toBe('unpublished');
    expect(await isPublished()).toBe(false);
  });
});
