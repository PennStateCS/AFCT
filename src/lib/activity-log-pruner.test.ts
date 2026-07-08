import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  systemSettings: { findUnique: vi.fn() },
  activityLog: { deleteMany: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { __test__ } from '@/lib/activity-log-pruner';

const { pruneOnce, getRetentionDays } = __test__;

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.activityLog.deleteMany.mockResolvedValue({ count: 0 });
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
