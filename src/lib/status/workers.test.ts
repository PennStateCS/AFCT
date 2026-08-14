import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  submission: { findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn() },
}));
const getQueueSettings = vi.hoisted(() => vi.fn());
const getEvaluatorConfig = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/eval-config', () => ({ getQueueSettings, getEvaluatorConfig }));

import { collectWorkers } from './workers';

const NOW = new Date('2026-08-14T12:00:00.000Z');
const TIMEOUT_MS = 30_000;
/** Anything older than the evaluator timeout plus the reaper's grace is overdue. */
const overdueBy = (ms: number) => new Date(NOW.getTime() - (TIMEOUT_MS + 60_000) - ms);
const startedAgo = (ms: number) => new Date(NOW.getTime() - ms);

const processing = (over: Record<string, unknown> = {}) => ({
  id: 's1',
  updatedAt: startedAgo(5_000),
  assignmentProblem: { problem: { type: 'FA' } },
  ...over,
});

/** counts are called in order: pending, then failed-in-the-last-hour */
const counts = (pending = 0, failed = 0) => {
  prismaMock.submission.count.mockReset();
  prismaMock.submission.count.mockResolvedValueOnce(pending).mockResolvedValueOnce(failed);
};

beforeEach(() => {
  vi.clearAllMocks();
  getQueueSettings.mockResolvedValue({ maxConcurrent: 5, maxAttempts: 5 });
  getEvaluatorConfig.mockResolvedValue({ timeoutMs: TIMEOUT_MS, maxMemoryMb: 512 });
  prismaMock.submission.findMany.mockResolvedValue([]);
  prismaMock.submission.findFirst.mockResolvedValue(null);
  counts();
});

describe('what the queue can say', () => {
  it('reports grading while work is in flight', async () => {
    prismaMock.submission.findMany.mockResolvedValue([processing()]);

    const res = await collectWorkers(NOW);

    expect(res.health).toBe('working');
    expect(res.busy).toBe(1);
    expect(res.configured).toBe(5);
  });

  /**
   * The case worth acting on: work queued, nothing collecting it. This is what a dead evaluator
   * looks like from the outside, and it needs no heartbeat to see.
   */
  it('reports a queue nothing is collecting', async () => {
    prismaMock.submission.findFirst.mockResolvedValue({ submittedAt: startedAgo(5 * 60_000) });
    counts(3);

    const res = await collectWorkers(NOW);

    expect(res.health).toBe('stalled');
    expect(res.oldestPendingMs).toBe(5 * 60_000);
  });

  /** A submission queued seconds ago has not been ignored yet; the loops poll on a delay. */
  it('gives a fresh submission time to be picked up before calling it stalled', async () => {
    prismaMock.submission.findFirst.mockResolvedValue({ submittedAt: startedAgo(10_000) });
    counts(1);

    expect((await collectWorkers(NOW)).health).toBe('idle');
  });

  it('flags work past the evaluator timeout', async () => {
    prismaMock.submission.findMany.mockResolvedValue([processing({ updatedAt: overdueBy(1_000) })]);

    const res = await collectWorkers(NOW);

    expect(res.health).toBe('stuck');
    expect(res.inFlight[0].stuck).toBe(true);
  });

  it('does not flag work that is merely slow', async () => {
    prismaMock.submission.findMany.mockResolvedValue([
      processing({ updatedAt: startedAgo(TIMEOUT_MS) }),
    ]);

    const res = await collectWorkers(NOW);

    expect(res.health).toBe('working');
    expect(res.inFlight[0].stuck).toBe(false);
  });

  /**
   * The honest limit of this approach, stated as a test so nobody quietly changes it: an empty
   * queue is reported as idle, never as healthy. The page says the same in words.
   */
  it('reports an empty queue as idle rather than claiming the evaluator is up', async () => {
    const res = await collectWorkers(NOW);

    expect(res.health).toBe('idle');
    expect(res.busy).toBe(0);
  });
});

describe('what it reports about work in flight', () => {
  it('gives the problem type and how long it has been running', async () => {
    prismaMock.submission.findMany.mockResolvedValue([
      processing({ updatedAt: startedAgo(90_000), assignmentProblem: { problem: { type: 'PDA' } } }),
    ]);

    const [w] = (await collectWorkers(NOW)).inFlight;

    expect(w.problemType).toBe('PDA');
    expect(w.runningForMs).toBe(90_000);
  });

  it('copes with a submission whose problem has no type', async () => {
    prismaMock.submission.findMany.mockResolvedValue([processing({ assignmentProblem: null })]);

    expect((await collectWorkers(NOW)).inFlight[0].problemType).toBeNull();
  });

  /**
   * The queue is grade data and this is an operations page. It may say what kind of work is in
   * flight and for how long; it may not say whose it is. Asserted on the query, because a later
   * `include` would leak a student without changing anything visible here.
   */
  it('asks the database for nothing that identifies a student', async () => {
    await collectWorkers(NOW);

    const args = prismaMock.submission.findMany.mock.calls[0][0];
    expect(args.select).toEqual({
      id: true,
      updatedAt: true,
      assignmentProblem: { select: { problem: { select: { type: true } } } },
    });
    expect(args.include).toBeUndefined();
    expect(JSON.stringify(args)).not.toMatch(/student|user|email|feedback|evaluationRaw/i);
  });

  it('counts failures from the last hour only', async () => {
    counts(0, 7);

    const res = await collectWorkers(NOW);

    expect(res.queue.failedLastHour).toBe(7);
    const failedArgs = prismaMock.submission.count.mock.calls[1][0];
    expect(failedArgs.where.updatedAt.gte).toEqual(new Date(NOW.getTime() - 60 * 60 * 1000));
  });
});
