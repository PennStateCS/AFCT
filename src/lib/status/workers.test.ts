import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  workerSlot: { findMany: vi.fn() },
  submission: { count: vi.fn(), findMany: vi.fn() },
}));
const getQueueSettings = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/eval-config', () => ({ getQueueSettings }));

import { collectWorkers } from './workers';
import { SLOT_STALE_MS } from '@/lib/worker-slots';

const NOW = new Date('2026-08-14T12:00:00.000Z');
const fresh = new Date(NOW.getTime() - 5_000);
const stale = new Date(NOW.getTime() - SLOT_STALE_MS - 1_000);

const slot = (over: Record<string, unknown> = {}) => ({
  runId: 'run-1',
  slot: 1,
  source: 'WORKER_CONTAINER',
  startedAt: new Date(NOW.getTime() - 600_000),
  lastSeenAt: fresh,
  submissionId: null,
  busySince: null,
  ...over,
});

/** counts are called in order: pending, processing, failed-in-the-last-hour */
const counts = (pending = 0, processing = 0, failed = 0) => {
  // Reset first: these are queued one-shot values, so a call inside a test would otherwise sit
  // behind the defaults set in beforeEach and never be reached.
  prismaMock.submission.count.mockReset();
  prismaMock.submission.count
    .mockResolvedValueOnce(pending)
    .mockResolvedValueOnce(processing)
    .mockResolvedValueOnce(failed);
};

beforeEach(() => {
  vi.clearAllMocks();
  getQueueSettings.mockResolvedValue({ maxConcurrent: 3, maxAttempts: 5 });
  prismaMock.workerSlot.findMany.mockResolvedValue([]);
  prismaMock.submission.findMany.mockResolvedValue([]);
  counts();
});

describe('health', () => {
  it('is healthy when every configured slot is reporting', async () => {
    prismaMock.workerSlot.findMany.mockResolvedValue([slot({ slot: 1 }), slot({ slot: 2 }), slot({ slot: 3 })]);

    const res = await collectWorkers(NOW);

    expect(res.health).toBe('healthy');
    expect(res.live).toBe(3);
    expect(res.configured).toBe(3);
  });

  it('is degraded when fewer slots report than are configured', async () => {
    prismaMock.workerSlot.findMany.mockResolvedValue([slot({ slot: 1 })]);

    expect((await collectWorkers(NOW)).health).toBe('degraded');
  });

  /**
   * The reason the heartbeat exists. A row left behind by a process that died is still a row,
   * so presence proves nothing and only recency does.
   */
  it('does not count a slot that has stopped reporting as live', async () => {
    prismaMock.workerSlot.findMany.mockResolvedValue([
      slot({ slot: 1 }),
      slot({ slot: 2, lastSeenAt: stale }),
    ]);

    const res = await collectWorkers(NOW);

    expect(res.live).toBe(1);
    expect(res.slots.map((s) => s.state)).toEqual(['waiting', 'stale']);
  });

  it('is down when nothing is reporting, even with rows left behind', async () => {
    prismaMock.workerSlot.findMany.mockResolvedValue([slot({ lastSeenAt: stale })]);

    expect((await collectWorkers(NOW)).health).toBe('down');
  });

  /** A stale row can still name a submission. The state has to win over the field. */
  it('reports a stale slot as not reporting rather than as grading', async () => {
    prismaMock.workerSlot.findMany.mockResolvedValue([
      slot({ lastSeenAt: stale, submissionId: 's1', busySince: NOW }),
    ]);
    prismaMock.submission.findMany.mockResolvedValue([
      { id: 's1', assignmentProblem: { problem: { type: 'FA' } } },
    ]);

    expect((await collectWorkers(NOW)).slots[0].state).toBe('stale');
  });
});

describe('the alarm worth raising', () => {
  it('flags work waiting with nothing to collect it', async () => {
    prismaMock.workerSlot.findMany.mockResolvedValue([]);
    counts(4);

    const res = await collectWorkers(NOW);

    expect(res.backlogWithNoWorkers).toBe(true);
  });

  it('does not flag an empty queue with the evaluator stopped', async () => {
    prismaMock.workerSlot.findMany.mockResolvedValue([]);
    counts(0);

    const res = await collectWorkers(NOW);

    // Still down, but nothing is being held up, so it is not the same alarm.
    expect(res.health).toBe('down');
    expect(res.backlogWithNoWorkers).toBe(false);
  });

  it('does not flag a backlog that slots are working through', async () => {
    prismaMock.workerSlot.findMany.mockResolvedValue([slot()]);
    counts(9);

    expect((await collectWorkers(NOW)).backlogWithNoWorkers).toBe(false);
  });
});

describe('what a busy slot reports', () => {
  beforeEach(() => {
    prismaMock.workerSlot.findMany.mockResolvedValue([
      slot({ submissionId: 's1', busySince: new Date(NOW.getTime() - 90_000) }),
    ]);
    prismaMock.submission.findMany.mockResolvedValue([
      { id: 's1', assignmentProblem: { problem: { type: 'PDA' } } },
    ]);
  });

  it('names the kind of problem and how long it has been running', async () => {
    const [s] = (await collectWorkers(NOW)).slots;

    expect(s.state).toBe('grading');
    expect(s.problemType).toBe('PDA');
    expect(s.busySinceMs).toBe(90_000);
  });

  /**
   * The queue is grade data and this is an operations page. It may say what kind of work is in
   * flight and for how long; it may not say whose it is. This asserts the query, because a
   * later `include` would leak a student without changing anything visible here.
   */
  it('asks the database for nothing that identifies a student', async () => {
    await collectWorkers(NOW);

    const args = prismaMock.submission.findMany.mock.calls[0][0];
    expect(args.select).toEqual({
      id: true,
      assignmentProblem: { select: { problem: { select: { type: true } } } },
    });
    expect(args.include).toBeUndefined();
    expect(JSON.stringify(args)).not.toMatch(/student|user|email|feedback|evaluationRaw/i);
  });

  it('asks once for every busy slot rather than once per slot', async () => {
    prismaMock.workerSlot.findMany.mockResolvedValue([
      slot({ slot: 1, submissionId: 's1', busySince: NOW }),
      slot({ slot: 2, submissionId: 's2', busySince: NOW }),
    ]);

    await collectWorkers(NOW);

    expect(prismaMock.submission.findMany).toHaveBeenCalledTimes(1);
  });

  it('asks nothing when no slot is busy', async () => {
    prismaMock.workerSlot.findMany.mockResolvedValue([slot()]);

    await collectWorkers(NOW);

    expect(prismaMock.submission.findMany).not.toHaveBeenCalled();
  });
});
