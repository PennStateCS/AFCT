import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import {
  claimSubmission,
  holdsTheStandingGrade,
  persistEvaluation,
  writeIfStillOwned,
} from './submission-worker';

/**
 * Worker queue concurrency, against a real Postgres.
 *
 * The mocked worker suite can prove which queries we call and how we branch on their
 * results. It cannot prove the thing that actually matters here: that two workers
 * racing the same row produce exactly one winner. That is a property of Postgres row
 * locking, and a mocked `updateMany` returning `{ count: 1 }` twice would happily let a
 * double-claim regression through.
 *
 * These run against the throwaway `afct_test` database (see
 * vitest.db.config.ts) and are excluded from the default unit run.
 */

const SUFFIX = 'wrkint';
const ids = {
  user: `u-${SUFFIX}`,
  course: `c-${SUFFIX}`,
  assignment: `a-${SUFFIX}`,
  problem: `p-${SUFFIX}`,
};

async function seedFixtures() {
  await prisma.user.create({
    data: {
      id: ids.user,
      email: `${SUFFIX}@example.test`,
      firstName: 'Worker',
      lastName: 'Fixture',
      password: 'not-a-real-hash',
    },
  });
  await prisma.course.create({
    data: {
      id: ids.course,
      name: 'Worker Integration Course',
      code: `WINT ${Math.floor(Math.random() * 900 + 100)}`,
      semester: 'Summer 2026',
      credits: 3,
      timezone: 'America/New_York',
      startDate: new Date('2026-01-01'),
      endDate: new Date('2026-12-31'),
    },
  });
  await prisma.problem.create({
    data: { id: ids.problem, title: 'Fixture Problem', type: 'FA', courseId: ids.course },
  });
  await prisma.assignment.create({
    data: {
      id: ids.assignment,
      title: 'Fixture Assignment',
      courseId: ids.course,
      dueDate: new Date('2026-12-01'),
    },
  });
  await prisma.assignmentProblem.create({
    data: {
      assignmentId: ids.assignment,
      problemId: ids.problem,
      maxPoints: 100,
      maxSubmissions: -1,
    },
  });
}

async function destroyFixtures() {
  // Submissions and the join row cascade from these; delete children first anyway so a
  // partial seed from a failed run still cleans up.
  await prisma.submission.deleteMany({ where: { courseId: ids.course } });
  await prisma.groupSet.deleteMany({ where: { courseId: ids.course } });
  await prisma.assignmentProblem.deleteMany({ where: { assignmentId: ids.assignment } });
  await prisma.assignment.deleteMany({ where: { id: ids.assignment } });
  await prisma.problem.deleteMany({ where: { id: ids.problem } });
  await prisma.course.deleteMany({ where: { id: ids.course } });
  await prisma.user.deleteMany({ where: { id: ids.user } });
}

async function newSubmission(status: 'PENDING' | 'PROCESSING' = 'PENDING', attempts = 0) {
  return prisma.submission.create({
    data: {
      courseId: ids.course,
      assignmentId: ids.assignment,
      problemId: ids.problem,
      studentId: ids.user,
      status,
      attempts,
    },
  });
}

beforeAll(async () => {
  await destroyFixtures();
  await seedFixtures();
});

afterAll(async () => {
  await destroyFixtures();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.submission.deleteMany({ where: { courseId: ids.course } });
});

describe('claim exclusivity', () => {
  it('gives the row to exactly one of two concurrent claimers', async () => {
    const sub = await newSubmission();

    const results = await Promise.all([claimSubmission(sub.id), claimSubmission(sub.id)]);

    expect(results.filter(Boolean)).toHaveLength(1);

    const after = await prisma.submission.findUniqueOrThrow({ where: { id: sub.id } });
    expect(after.status).toBe('PROCESSING');
    // The decisive assertion: a double-claim would increment twice. If both callers
    // were told they won AND attempts is 2, the same submission is being evaluated by
    // two workers and one result will silently overwrite the other.
    expect(after.attempts).toBe(1);
  });

  it('gives the row to exactly one of eight concurrent claimers', async () => {
    // Two racers can pass by luck of scheduling; eight makes an unlocked read-then-write
    // overwhelmingly likely to produce more than one winner.
    const sub = await newSubmission();

    const results = await Promise.all(Array.from({ length: 8 }, () => claimSubmission(sub.id)));

    expect(results.filter(Boolean)).toHaveLength(1);
    const after = await prisma.submission.findUniqueOrThrow({ where: { id: sub.id } });
    expect(after.attempts).toBe(1);
  });

  it('refuses to claim a row that is already PROCESSING', async () => {
    const sub = await newSubmission('PROCESSING', 1);
    expect(await claimSubmission(sub.id)).toBeNull();

    const after = await prisma.submission.findUniqueOrThrow({ where: { id: sub.id } });
    expect(after.attempts).toBe(1); // untouched
  });

  it('lets a reaped row be claimed again, and counts the re-claim', async () => {
    const sub = await newSubmission('PROCESSING', 1);
    // What reapStuckSubmissions does: hand the row back to the queue.
    await prisma.submission.update({ where: { id: sub.id }, data: { status: 'PENDING' } });

    expect(await claimSubmission(sub.id)).toBeTruthy();
    const after = await prisma.submission.findUniqueOrThrow({ where: { id: sub.id } });
    expect(after.attempts).toBe(2);
  });

  it('does not claim a submission that no longer exists', async () => {
    expect(await claimSubmission('missing-submission-id')).toBeNull();
  });
});

describe('fencing token', () => {
  it('discards a stale write from a worker whose row was reaped and re-claimed', async () => {
    // 1. Worker A claims and remembers its token.
    const sub = await newSubmission();
    const workerA = await claimSubmission(sub.id);
    expect(workerA).toBeTruthy();

    // 2. A is presumed stuck: the row is reaped and re-claimed by worker B.
    await prisma.submission.update({
      where: { id: sub.id },
      data: { status: 'PENDING', processingToken: null },
    });
    const workerB = await claimSubmission(sub.id);
    expect(workerB).toBeTruthy();

    // 3. Worker B finishes first and writes its verdict.
    expect(await writeIfStillOwned(sub.id, workerB, { correct: true, feedback: 'from B' })).toBe(
      true,
    );

    // 4. Worker A finally comes back with a stale result. It must affect zero rows.
    const aWrote = await writeIfStillOwned(sub.id, workerA, {
      correct: false,
      feedback: 'from A (stale)',
    });

    expect(aWrote).toBe(false);
    const after = await prisma.submission.findUniqueOrThrow({ where: { id: sub.id } });
    expect(after.feedback).toBe('from B');
    expect(after.correct).toBe(true);
  });

  /**
   * The sequence the counter could not survive.
   *
   * A rerun set `attempts` back to 0 and the next claim took it to 1 again, which is exactly
   * the value the worker from the previous run was holding. Its result then matched and
   * overwrote the newer evaluation, and the gradebook took the older verdict.
   */
  it('discards a stale write after a rerun, where the old counter came back round', async () => {
    const sub = await newSubmission();

    // 1. Worker A claims it.
    const workerA = await claimSubmission(sub.id);

    // 2. Staff rerun it: back on the queue, fresh attempt budget, owned by nobody.
    await prisma.submission.update({
      where: { id: sub.id },
      data: { status: 'PENDING', attempts: 0, processingToken: null, feedback: null },
    });

    // 3. Worker B claims the rerun. `attempts` is 1 again, as it was for A.
    const workerB = await claimSubmission(sub.id);
    const claimed = await prisma.submission.findUniqueOrThrow({ where: { id: sub.id } });
    expect(claimed.attempts).toBe(1);

    // 4. Worker A finishes and tries to write.
    const aWrote = await writeIfStillOwned(sub.id, workerA, {
      correct: false,
      feedback: 'from A (before the rerun)',
    });

    // 5. Refused, and 6. B still owns the row.
    expect(aWrote).toBe(false);
    expect(await writeIfStillOwned(sub.id, workerB, { correct: true, feedback: 'from B' })).toBe(
      true,
    );
    const after = await prisma.submission.findUniqueOrThrow({ where: { id: sub.id } });
    expect(after.feedback).toBe('from B');
  });

  it('stops a stale worker putting a finished row back on the queue', async () => {
    // The failure path writes PENDING or FAILED, and those have to be fenced too: a stale
    // worker resurrecting a row somebody else has finished is the same bug wearing a hat.
    const sub = await newSubmission();
    const workerA = await claimSubmission(sub.id);
    await prisma.submission.update({
      where: { id: sub.id },
      data: { status: 'PENDING', processingToken: null },
    });
    const workerB = await claimSubmission(sub.id);
    await writeIfStillOwned(sub.id, workerB, { status: 'COMPLETED', correct: true });

    expect(await writeIfStillOwned(sub.id, workerA, { status: 'PENDING' })).toBe(false);
    expect(await writeIfStillOwned(sub.id, workerA, { status: 'FAILED' })).toBe(false);

    const after = await prisma.submission.findUniqueOrThrow({ where: { id: sub.id } });
    expect(after.status).toBe('COMPLETED');
  });

  it('accepts a write from the worker that still owns the row', async () => {
    const sub = await newSubmission();
    const token = await claimSubmission(sub.id);

    expect(await writeIfStillOwned(sub.id, token, { feedback: 'ok', correct: true })).toBe(true);
    const after = await prisma.submission.findUniqueOrThrow({ where: { id: sub.id } });
    expect(after.feedback).toBe('ok');
  });

  it('refuses a write from a caller that never claimed the row', async () => {
    // Changed deliberately: an unfenced write used to be allowed when no token was known.
    // A worker that never got a claim has no business writing to the row, and the failure
    // path that used to rely on it now fails before there is anything to write.
    const sub = await newSubmission('PROCESSING', 3);

    expect(await writeIfStillOwned(sub.id, null, { status: 'PENDING' })).toBe(false);
    const after = await prisma.submission.findUniqueOrThrow({ where: { id: sub.id } });
    expect(after.status).toBe('PROCESSING');
  });

  it('does not let two stale workers both resurrect a finished row', async () => {
    const sub = await newSubmission();
    const stale = await claimSubmission(sub.id);
    await prisma.submission.update({
      where: { id: sub.id },
      data: { status: 'PENDING', processingToken: null },
    });
    await claimSubmission(sub.id); // the current owner

    const [a, b] = await Promise.all([
      writeIfStillOwned(sub.id, stale, { status: 'FAILED', feedback: 'stale A' }),
      writeIfStillOwned(sub.id, stale, { status: 'FAILED', feedback: 'stale B' }),
    ]);

    expect(a).toBe(false);
    expect(b).toBe(false);
    const after = await prisma.submission.findUniqueOrThrow({ where: { id: sub.id } });
    expect(after.status).toBe('PROCESSING');
  });
});

/**
 * Which submission decides the student's standing grade.
 *
 * AFCT keeps the result of an attempt and the student's grade for the problem as two different
 * things. Rerunning an old attempt refreshes the first; rolling the gradebook back to it is the
 * bug. Ordering and the group scope are the parts that can be wrong, so they are checked against
 * a real database rather than a mock that would agree with whatever was written.
 */
describe('which submission holds the standing grade', () => {
  const at = (iso: string, over: Record<string, unknown> = {}) =>
    prisma.submission.create({
      data: {
        courseId: ids.course,
        assignmentId: ids.assignment,
        problemId: ids.problem,
        studentId: ids.user,
        status: 'COMPLETED',
        submittedAt: new Date(iso),
        ...over,
      },
    });

  it('is the latest attempt, so rerunning an older one does not move the grade', async () => {
    const first = await at('2026-05-01T10:00:00Z');
    const second = await at('2026-05-02T10:00:00Z');

    // A: attempt 1 wrong, attempt 2 right, staff rerun attempt 1. The rerun refreshes its own
    // result and leaves the gradebook on attempt 2.
    expect(await holdsTheStandingGrade(prisma, first)).toBe(false);
    expect(await holdsTheStandingGrade(prisma, second)).toBe(true);
  });

  it('stops an older evaluation that finishes after a newer submission arrives', async () => {
    // B: attempt 1 is still being evaluated when attempt 2 is submitted. The check runs at the
    // moment the grade is written, so attempt 1 has already lost by then.
    const running = await at('2026-05-01T10:00:00Z');
    expect(await holdsTheStandingGrade(prisma, running)).toBe(true);

    await at('2026-05-01T10:00:05Z');

    expect(await holdsTheStandingGrade(prisma, running)).toBe(false);
  });

  it('breaks a tie on the same instant the same way every time', async () => {
    // Two submissions can share a timestamp; what matters is that the answer does not change
    // between the check and the next one.
    const a = await at('2026-05-03T10:00:00Z');
    const b = await at('2026-05-03T10:00:00Z');
    const winner = (await holdsTheStandingGrade(prisma, a)) ? a.id : b.id;

    expect(await holdsTheStandingGrade(prisma, a)).toBe(winner === a.id);
    expect(await holdsTheStandingGrade(prisma, b)).toBe(winner === b.id);
  });

  describe('on a group assignment', () => {
    const GROUP = `g-${SUFFIX}`;
    const OTHER_GROUP = `g2-${SUFFIX}`;

    beforeEach(async () => {
      // One set per run, reused: the name is unique per course, so recreating it each time
      // collides with the row the previous test left behind.
      await prisma.studentGroup.deleteMany({ where: { id: { in: [GROUP, OTHER_GROUP] } } });
      await prisma.groupSet.deleteMany({ where: { courseId: ids.course } });
      const set = await prisma.groupSet.create({
        data: { name: `Set ${SUFFIX}`, courseId: ids.course },
      });
      await prisma.studentGroup.createMany({
        data: [
          { id: GROUP, name: 'Group A', groupSetId: set.id },
          { id: OTHER_GROUP, name: 'Group B', groupSetId: set.id },
        ],
      });
    });

    it('follows the group stream, not the individual submitter', async () => {
      // C: the group's later submission holds the grade, even though a different member made
      // it. A group is graded together, so its stream is what counts.
      const first = await at('2026-06-01T10:00:00Z', { studentGroupId: GROUP });
      const second = await at('2026-06-02T10:00:00Z', { studentGroupId: GROUP });

      expect(await holdsTheStandingGrade(prisma, first)).toBe(false);
      expect(await holdsTheStandingGrade(prisma, second)).toBe(true);
    });

    it('is not affected by another group submitting later', async () => {
      const ours = await at('2026-06-03T10:00:00Z', { studentGroupId: GROUP });
      await at('2026-06-04T10:00:00Z', { studentGroupId: OTHER_GROUP });

      expect(await holdsTheStandingGrade(prisma, ours)).toBe(true);
    });
  });
});

/**
 * Persisting an evaluation: the attempt's result, the standing grade and the claim, as one unit.
 *
 * The claim used to be released with the result and the grade written afterwards. A failure in
 * between left a submission COMPLETED, unowned, with a stale or missing grade, and nothing on
 * the queue to fix it: no state that is recoverable, because the row no longer looks like work.
 * These run against real Postgres because that is where the atomicity and the isolation live.
 */
describe('persisting an evaluation', () => {
  const OK = {
    feedback: 'looks right',
    correct: true,
    evaluationRaw: { verdict: 'ok' },
    status: 'COMPLETED' as const,
  };

  const persist = (
    submission: { id: string; studentGroupId?: string | null },
    token: string | null,
    over: Partial<Parameters<typeof persistEvaluation>[0]> = {},
  ) =>
    persistEvaluation({
      id: submission.id,
      token,
      assignmentId: ids.assignment,
      problemId: ids.problem,
      studentId: ids.user,
      studentGroupId: submission.studentGroupId ?? null,
      autograderEnabled: true,
      maxPoints: 100,
      evaluation: OK,
      ...over,
    });

  const gradeRows = () =>
    prisma.assignmentProblemGrade.findMany({ where: { assignmentId: ids.assignment } });

  beforeEach(async () => {
    await prisma.assignmentProblemGrade.deleteMany({ where: { assignmentId: ids.assignment } });
  });

  it('saves the result, the grade and the released claim together', async () => {
    const sub = await newSubmission();
    const token = await claimSubmission(sub.id);

    expect(await persist(sub, token)).toBe('graded');

    const after = await prisma.submission.findUniqueOrThrow({ where: { id: sub.id } });
    expect(after).toMatchObject({ status: 'COMPLETED', correct: true, processingToken: null });
    expect(await gradeRows()).toMatchObject([{ grade: 100, gradeSource: 'AUTOGRADER' }]);
  });

  /**
   * The failure this whole shape exists for. Nothing may be left committed, and the row has to
   * still be somebody's work, or it is stranded: finished-looking, ungraded, and off the queue.
   */
  it('leaves the submission owned and unfinished when the grade write fails', async () => {
    const sub = await newSubmission();
    const token = await claimSubmission(sub.id);

    // A grade write that cannot succeed: the assignment it names does not exist, so the row
    // fails its foreign key inside the transaction.
    await expect(persist(sub, token, { assignmentId: 'no-such-assignment' })).rejects.toThrow();

    const after = await prisma.submission.findUniqueOrThrow({ where: { id: sub.id } });
    // The attempt result rolled back with the grade: not COMPLETED, and still claimed.
    expect(after.status).toBe('PROCESSING');
    expect(after.processingToken).toBe(token);
    expect(after.feedback).toBeNull();
    expect(await gradeRows()).toHaveLength(0);

    // And therefore recoverable: the worker's own requeue still matches the row.
    expect(
      await writeIfStillOwned(sub.id, token, { status: 'PENDING', processingToken: null }),
    ).toBe(true);
  });

  it('changes nothing at all for a worker that has lost the row', async () => {
    const sub = await newSubmission();
    const stale = await claimSubmission(sub.id);
    await prisma.submission.update({
      where: { id: sub.id },
      data: { status: 'PENDING', processingToken: null },
    });
    const owner = await claimSubmission(sub.id);

    expect(await persist(sub, stale)).toBe('stale');

    const after = await prisma.submission.findUniqueOrThrow({ where: { id: sub.id } });
    expect(after.status).toBe('PROCESSING');
    expect(after.feedback).toBeNull();
    expect(after.processingToken).toBe(owner);
    expect(await gradeRows()).toHaveLength(0);
  });

  it('writes nothing for a caller that never claimed the row', async () => {
    const sub = await newSubmission();

    expect(await persist(sub, null)).toBe('stale');

    expect((await prisma.submission.findUniqueOrThrow({ where: { id: sub.id } })).status).toBe(
      'PENDING',
    );
  });

  it("saves an older attempt's own result without moving the grade", async () => {
    // Attempt 1 is rerun after attempt 2 has already taken the grade.
    const first = await newSubmission();
    await prisma.submission.create({
      data: {
        courseId: ids.course,
        assignmentId: ids.assignment,
        problemId: ids.problem,
        studentId: ids.user,
        status: 'COMPLETED',
        submittedAt: new Date(Date.now() + 60_000),
      },
    });
    await prisma.assignmentProblemGrade.create({
      data: {
        assignmentId: ids.assignment,
        problemId: ids.problem,
        studentId: ids.user,
        grade: 100,
        gradedManually: false,
        gradeSource: 'AUTOGRADER',
      },
    });
    const token = await claimSubmission(first.id);

    expect(
      await persist(first, token, {
        evaluation: { ...OK, correct: false, feedback: 'still wrong' },
      }),
    ).toBe('grade-skipped');

    const after = await prisma.submission.findUniqueOrThrow({ where: { id: first.id } });
    // Its own result is refreshed...
    expect(after).toMatchObject({ correct: false, feedback: 'still wrong', processingToken: null });
    // ...and the gradebook keeps the later work.
    expect(await gradeRows()).toMatchObject([{ grade: 100 }]);
  });

  it('does not touch a grade somebody entered by hand', async () => {
    const sub = await newSubmission();
    await prisma.assignmentProblemGrade.create({
      data: {
        assignmentId: ids.assignment,
        problemId: ids.problem,
        studentId: ids.user,
        grade: 42,
        feedback: 'marked by a person',
        gradedManually: true,
        gradeSource: 'MANUAL',
      },
    });
    const token = await claimSubmission(sub.id);

    expect(await persist(sub, token)).toBe('graded');

    expect(await gradeRows()).toMatchObject([
      { grade: 42, gradedManually: true, gradeSource: 'MANUAL' },
    ]);
  });

  it('saves the result and no grade at all when the autograder is off', async () => {
    const sub = await newSubmission();
    const token = await claimSubmission(sub.id);

    expect(await persist(sub, token, { autograderEnabled: false })).toBe('no-autograde');

    const after = await prisma.submission.findUniqueOrThrow({ where: { id: sub.id } });
    expect(after).toMatchObject({ status: 'COMPLETED', processingToken: null });
    expect(await gradeRows()).toHaveLength(0);
  });
});

/**
 * Two workers, or a worker and a student, at the same moment.
 *
 * The authority check is a read, and a read can be made wrong by a write that commits after it.
 * Serializable is what stops the older verdict landing last; these prove it against Postgres
 * rather than against a mock that would agree with whatever was written.
 */
describe('persisting an evaluation while something else happens', () => {
  const OK = {
    feedback: 'ok',
    correct: true,
    evaluationRaw: null,
    status: 'COMPLETED' as const,
  };

  const persistFor = (id: string, token: string | null, feedback: string) =>
    persistEvaluation({
      id,
      token,
      assignmentId: ids.assignment,
      problemId: ids.problem,
      studentId: ids.user,
      studentGroupId: null,
      autograderEnabled: true,
      maxPoints: 100,
      evaluation: { ...OK, feedback },
    });

  beforeEach(async () => {
    await prisma.assignmentProblemGrade.deleteMany({ where: { assignmentId: ids.assignment } });
  });

  it('leaves the grade to the newer submission when one arrives mid-evaluation', async () => {
    const running = await newSubmission();
    const token = await claimSubmission(running.id);

    // Submitted while the evaluator was still working on the first attempt.
    await prisma.submission.create({
      data: {
        courseId: ids.course,
        assignmentId: ids.assignment,
        problemId: ids.problem,
        studentId: ids.user,
        status: 'PENDING',
        submittedAt: new Date(Date.now() + 30_000),
      },
    });

    expect(await persistFor(running.id, token, 'from the older attempt')).toBe('grade-skipped');

    // Its own result is saved, and the gradebook waits for the newer attempt.
    const after = await prisma.submission.findUniqueOrThrow({ where: { id: running.id } });
    expect(after).toMatchObject({ feedback: 'from the older attempt', processingToken: null });
    expect(
      await prisma.assignmentProblemGrade.count({ where: { assignmentId: ids.assignment } }),
    ).toBe(0);
  });

  /**
   * The interleaving the isolation level exists for.
   *
   * An older attempt reads "am I the latest?" and is told yes. Before it writes, a newer
   * submission arrives *and is graded*. At a weaker isolation level the older write lands last
   * and the student's grade goes backwards for good; the check was true when it was read and
   * false by the time it mattered. The pause is the only way to hold that window open, since
   * nothing can commit inside somebody else's transaction from the outside.
   */
  it('refuses an older attempt whose authority went stale while it was writing', async () => {
    const older = await newSubmission();
    const tokenA = await claimSubmission(older.id);

    const conflict = await (async () => {
      let outcome: unknown;
      try {
        outcome = await persistEvaluation({
          id: older.id,
          token: tokenA,
          assignmentId: ids.assignment,
          problemId: ids.problem,
          studentId: ids.user,
          studentGroupId: null,
          autograderEnabled: true,
          maxPoints: 100,
          evaluation: { feedback: 'A', correct: false, evaluationRaw: null, status: 'COMPLETED' },
          // While A holds its authority decision: a newer attempt is submitted and graded.
          pauseBeforeGradeWrite: async () => {
            const newer = await prisma.submission.create({
              data: {
                courseId: ids.course,
                assignmentId: ids.assignment,
                problemId: ids.problem,
                studentId: ids.user,
                status: 'PENDING',
                submittedAt: new Date(Date.now() + 30_000),
              },
            });
            const tokenB = await claimSubmission(newer.id);
            await persistEvaluation({
              id: newer.id,
              token: tokenB,
              assignmentId: ids.assignment,
              problemId: ids.problem,
              studentId: ids.user,
              studentGroupId: null,
              autograderEnabled: true,
              maxPoints: 100,
              evaluation: {
                feedback: 'B',
                correct: true,
                evaluationRaw: null,
                status: 'COMPLETED',
              },
            });
          },
        });
      } catch (error) {
        return error;
      }
      return outcome;
    })();

    // Postgres refuses the older transaction rather than letting its write land last.
    expect(conflict).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect((conflict as Prisma.PrismaClientKnownRequestError).code).toBe('P2034');

    // The newer attempt's grade stands, and the older attempt is still owned, so the worker
    // puts it back on the queue rather than losing it.
    const grades = await prisma.assignmentProblemGrade.findMany({
      where: { assignmentId: ids.assignment },
    });
    expect(grades).toMatchObject([{ grade: 100, feedback: 'B' }]);
    const stale = await prisma.submission.findUniqueOrThrow({ where: { id: older.id } });
    expect(stale).toMatchObject({ status: 'PROCESSING', processingToken: tokenA });
    expect(stale.feedback).toBeNull();
  });
});
