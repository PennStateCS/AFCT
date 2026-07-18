import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  groupSet: { findUnique: vi.fn(), updateMany: vi.fn(), findMany: vi.fn() },
  assignment: { count: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import {
  lockGroupSetIfUsed,
  isGroupSetLocked,
  assertGroupSetUnlocked,
  groupSetDeletionBlockers,
} from './group-set-service';
import { GroupSetLockedError } from './group-sets';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('lockGroupSetIfUsed', () => {
  it('is a no-op when there is no group set (individual assignment)', async () => {
    await lockGroupSetIfUsed(prismaMock as never, null);
    await lockGroupSetIfUsed(prismaMock as never, undefined);
    expect(prismaMock.groupSet.updateMany).not.toHaveBeenCalled();
  });

  it('stamps lockedAt only when still unset (sticky + idempotent)', async () => {
    await lockGroupSetIfUsed(prismaMock as never, 'gs1');
    const arg = prismaMock.groupSet.updateMany.mock.calls[0]![0];
    // The where filters lockedAt: null, so a second call never overwrites the first stamp.
    expect(arg.where).toEqual({ id: 'gs1', lockedAt: null });
    expect(arg.data.lockedAt).toBeInstanceOf(Date);
  });
});

describe('isGroupSetLocked', () => {
  it('is true once lockedAt is set, false otherwise', async () => {
    prismaMock.groupSet.findUnique.mockResolvedValueOnce({ lockedAt: new Date() });
    expect(await isGroupSetLocked('gs1')).toBe(true);
    prismaMock.groupSet.findUnique.mockResolvedValueOnce({ lockedAt: null });
    expect(await isGroupSetLocked('gs1')).toBe(false);
  });

  it('assertGroupSetUnlocked throws when locked', async () => {
    prismaMock.groupSet.findUnique.mockResolvedValue({ lockedAt: new Date() });
    await expect(assertGroupSetUnlocked('gs1')).rejects.toBeInstanceOf(GroupSetLockedError);
  });
});

describe('groupSetDeletionBlockers', () => {
  it('blocks a locked set and a referenced set, allows an empty unlocked one', async () => {
    prismaMock.groupSet.findUnique.mockResolvedValue({ lockedAt: new Date() });
    prismaMock.assignment.count.mockResolvedValue(2);
    expect(await groupSetDeletionBlockers('gs1')).toHaveLength(2);

    prismaMock.groupSet.findUnique.mockResolvedValue({ lockedAt: null });
    prismaMock.assignment.count.mockResolvedValue(0);
    expect(await groupSetDeletionBlockers('gs1')).toEqual([]);
  });
});
