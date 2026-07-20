import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';
import { claimSubmission, writeIfStillOwned } from './submission-worker';

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
 * vitest.integration.config.ts) and are excluded from the default unit run.
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

    const results = await Promise.all(
      Array.from({ length: 8 }, () => claimSubmission(sub.id)),
    );

    expect(results.filter(Boolean)).toHaveLength(1);
    const after = await prisma.submission.findUniqueOrThrow({ where: { id: sub.id } });
    expect(after.attempts).toBe(1);
  });

  it('refuses to claim a row that is already PROCESSING', async () => {
    const sub = await newSubmission('PROCESSING', 1);
    expect(await claimSubmission(sub.id)).toBe(false);

    const after = await prisma.submission.findUniqueOrThrow({ where: { id: sub.id } });
    expect(after.attempts).toBe(1); // untouched
  });

  it('lets a reaped row be claimed again, and counts the re-claim', async () => {
    const sub = await newSubmission('PROCESSING', 1);
    // What reapStuckSubmissions does: hand the row back to the queue.
    await prisma.submission.update({ where: { id: sub.id }, data: { status: 'PENDING' } });

    expect(await claimSubmission(sub.id)).toBe(true);
    const after = await prisma.submission.findUniqueOrThrow({ where: { id: sub.id } });
    expect(after.attempts).toBe(2);
  });

  it('does not claim a submission that no longer exists', async () => {
    expect(await claimSubmission('missing-submission-id')).toBe(false);
  });
});

describe('fencing token', () => {
  it('discards a stale write from a worker whose row was reaped and re-claimed', async () => {
    // 1. Worker A claims (attempts 0 -> 1) and remembers its token.
    const sub = await newSubmission();
    expect(await claimSubmission(sub.id)).toBe(true);
    const workerAToken = (await prisma.submission.findUniqueOrThrow({ where: { id: sub.id } }))
      .attempts;
    expect(workerAToken).toBe(1);

    // 2. A is presumed stuck: the row is reaped and re-claimed as attempt 2 by worker B.
    await prisma.submission.update({ where: { id: sub.id }, data: { status: 'PENDING' } });
    expect(await claimSubmission(sub.id)).toBe(true);

    // 3. Worker B finishes first and writes its verdict.
    const bWrote = await writeIfStillOwned(sub.id, 2, { correct: true, feedback: 'from B' });
    expect(bWrote).toBe(true);

    // 4. Worker A finally comes back with a stale result. It must affect zero rows.
    const aWrote = await writeIfStillOwned(sub.id, workerAToken, {
      correct: false,
      feedback: 'from A (stale)',
    });

    expect(aWrote).toBe(false);
    const after = await prisma.submission.findUniqueOrThrow({ where: { id: sub.id } });
    expect(after.feedback).toBe('from B');
    expect(after.correct).toBe(true);
  });

  it('accepts a write from the worker that still owns the row', async () => {
    const sub = await newSubmission();
    await claimSubmission(sub.id);

    expect(await writeIfStillOwned(sub.id, 1, { feedback: 'ok', correct: true })).toBe(true);
    const after = await prisma.submission.findUniqueOrThrow({ where: { id: sub.id } });
    expect(after.feedback).toBe('ok');
  });

  it('writes unfenced when the claim token was never learned', async () => {
    // The failure path passes null when it blew up before reading the row; there is no
    // token to be stale relative to, so the write must still land.
    const sub = await newSubmission('PROCESSING', 3);

    expect(await writeIfStillOwned(sub.id, null, { status: 'PENDING' })).toBe(true);
    const after = await prisma.submission.findUniqueOrThrow({ where: { id: sub.id } });
    expect(after.status).toBe('PENDING');
  });

  it('does not let two stale workers both resurrect a finished row', async () => {
    const sub = await newSubmission();
    await claimSubmission(sub.id); // attempts 1
    await prisma.submission.update({ where: { id: sub.id }, data: { status: 'PENDING' } });
    await claimSubmission(sub.id); // attempts 2, current owner

    const [a, b] = await Promise.all([
      writeIfStillOwned(sub.id, 1, { status: 'FAILED', feedback: 'stale A' }),
      writeIfStillOwned(sub.id, 1, { status: 'FAILED', feedback: 'stale B' }),
    ]);

    expect(a).toBe(false);
    expect(b).toBe(false);
    const after = await prisma.submission.findUniqueOrThrow({ where: { id: sub.id } });
    expect(after.status).toBe('PROCESSING');
  });
});
