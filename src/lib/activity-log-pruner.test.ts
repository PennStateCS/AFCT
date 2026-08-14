import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  systemSettings: { findUnique: vi.fn() },
  activityLog: { deleteMany: vi.fn() },
  singleUseToken: { deleteMany: vi.fn() },
  mailQueue: { deleteMany: vi.fn() },
  ltiLaunchTransaction: { deleteMany: vi.fn() },
  ltiPendingLink: { deleteMany: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { __test__ } from '@/lib/activity-log-pruner';

const { pruneOnce, getRetentionDays } = __test__;

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.activityLog.deleteMany.mockResolvedValue({ count: 0 });
  prismaMock.singleUseToken.deleteMany.mockResolvedValue({ count: 0 });
  prismaMock.mailQueue.deleteMany.mockResolvedValue({ count: 0 });
  prismaMock.ltiLaunchTransaction.deleteMany.mockResolvedValue({ count: 0 });
  prismaMock.ltiPendingLink.deleteMany.mockResolvedValue({ count: 0 });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('getRetentionDays', () => {
  it('returns the configured value', async () => {
    prismaMock.systemSettings.findUnique.mockResolvedValue({ activityLogRetentionDays: 90 });
    expect(await getRetentionDays()).toBe(90);
  });

  it('clamps an out-of-range value to the bounds', async () => {
    prismaMock.systemSettings.findUnique.mockResolvedValue({ activityLogRetentionDays: 1 });
    expect(await getRetentionDays()).toBe(30); // MIN_ACTIVITY_LOG_RETENTION_DAYS
  });

  it('falls back to the default when no settings row exists', async () => {
    prismaMock.systemSettings.findUnique.mockResolvedValue(null);
    expect(await getRetentionDays()).toBe(365);
  });

  it('falls back to the default when the query throws', async () => {
    prismaMock.systemSettings.findUnique.mockRejectedValue(new Error('db down'));
    expect(await getRetentionDays()).toBe(365);
  });
});

describe('pruneOnce', () => {
  it('deletes rows older than the retention cutoff', async () => {
    prismaMock.systemSettings.findUnique.mockResolvedValue({ activityLogRetentionDays: 100 });
    prismaMock.activityLog.deleteMany.mockResolvedValue({ count: 5 });

    const before = Date.now();
    await pruneOnce();

    expect(prismaMock.activityLog.deleteMany).toHaveBeenCalledTimes(1);
    const cutoff = prismaMock.activityLog.deleteMany.mock.calls[0][0].where.timestamp.lt as Date;
    const expected = before - 100 * 24 * 60 * 60 * 1000;
    expect(Math.abs(cutoff.getTime() - expected)).toBeLessThan(60_000);
  });

  it('swallows errors so a failed prune never crashes the process', async () => {
    prismaMock.systemSettings.findUnique.mockResolvedValue({ activityLogRetentionDays: 100 });
    prismaMock.activityLog.deleteMany.mockRejectedValue(new Error('boom'));
    await expect(pruneOnce()).resolves.toBeUndefined();
  });
});

/**
 * Expired single-use tokens share the log pruner's daily pass. Both are retention chores on
 * the same schedule, so one loop is one thing to reason about. The property that matters is
 * that they are independent: a sweep that cannot run must not stop the one beside it.
 */
describe('the single-use token sweep', () => {
  it('deletes expired tokens', async () => {
    prismaMock.singleUseToken.deleteMany.mockResolvedValue({ count: 3 });

    await __test__.purgeTokensOnce();

    expect(prismaMock.singleUseToken.deleteMany).toHaveBeenCalled();
  });

  it('logs and swallows a failure rather than stopping the pass', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    prismaMock.singleUseToken.deleteMany.mockRejectedValueOnce(new Error('db down'));

    await expect(__test__.purgeTokensOnce()).resolves.toBeUndefined();
    expect(consoleSpy).toHaveBeenCalled();
  });
});

/**
 * Messages that have been sent or given up on.
 *
 * Their bodies are cleared when they finish, so the rows are small; the reason to sweep them is
 * that nothing else ever did. An unbounded table on a box where disk is the binding constraint
 * is a slow leak rather than no problem.
 */
describe('sweeping finished mail', () => {
  it('deletes messages that have been sent or failed', async () => {
    prismaMock.mailQueue.deleteMany.mockResolvedValue({ count: 4 });

    await __test__.purgeSentMailOnce();

    const where = prismaMock.mailQueue.deleteMany.mock.calls[0][0].where;
    expect(where.state.in).toEqual(['SENT', 'FAILED']);
  });

  // A week: long enough to answer "did my reset email go out last Tuesday", short enough that
  // the table stays flat.
  it('keeps them for a week', async () => {
    await __test__.purgeSentMailOnce();

    const cutoff = prismaMock.mailQueue.deleteMany.mock.calls[0][0].where.updatedAt.lt as Date;
    const days = (Date.now() - cutoff.getTime()) / (24 * 60 * 60 * 1000);
    expect(days).toBeCloseTo(7, 1);
  });

  // Nothing waiting is not an event worth a line in the log.
  it('says nothing when there was nothing to delete', async () => {
    const log = vi.spyOn(console, 'log');

    await __test__.purgeSentMailOnce();

    expect(log).not.toHaveBeenCalled();
  });

  /** One sweep failing must never stop the ones beside it in the same daily pass. */
  it('swallows a failure rather than stopping the pass', async () => {
    prismaMock.mailQueue.deleteMany.mockRejectedValue(new Error('database is away'));

    await expect(__test__.purgeSentMailOnce()).resolves.toBeUndefined();
  });
});

/**
 * What the daily pass actually runs.
 *
 * The failure worth guarding is not a broken sweep, it is a sweep nobody reaches: `purgeSentMail`
 * was written, tested in isolation, and never called from anywhere for as long as it existed.
 */
describe('the daily pass', () => {
  it('runs every sweep', async () => {
    await __test__.runOnce();

    expect(prismaMock.activityLog.deleteMany).toHaveBeenCalled();
    expect(prismaMock.singleUseToken.deleteMany).toHaveBeenCalled();
    expect(prismaMock.ltiLaunchTransaction.deleteMany).toHaveBeenCalled();
    expect(prismaMock.ltiPendingLink.deleteMany).toHaveBeenCalled();
    expect(prismaMock.mailQueue.deleteMany).toHaveBeenCalled();
  });

  // One sweep failing must not take the rest of the pass with it.
  it('finishes the pass when one sweep fails', async () => {
    prismaMock.singleUseToken.deleteMany.mockRejectedValue(new Error('database is away'));

    await __test__.runOnce();

    expect(prismaMock.mailQueue.deleteMany).toHaveBeenCalled();
  });
});
