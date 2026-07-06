import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  user: {
    findMany: vi.fn(),
  },
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { getUsersList } from '@/lib/users-list';

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.user.findMany.mockResolvedValue([]);
});

const args = () => prismaMock.user.findMany.mock.calls[0][0];

describe('getUsersList', () => {
  it('filters by role when one is provided', async () => {
    await getUsersList('FACULTY');
    expect(args().where).toEqual({ role: 'FACULTY' });
  });

  it('returns all users (no where filter) when no role is given', async () => {
    await getUsersList();
    expect(args().where).toBeUndefined();
  });

  it('treats null the same as "no filter"', async () => {
    await getUsersList(null);
    expect(args().where).toBeUndefined();
  });

  it('sorts by role then last name', async () => {
    await getUsersList();
    expect(args().orderBy).toEqual([{ role: 'asc' }, { lastName: 'asc' }]);
  });

  it('passes through the query result', async () => {
    const rows = [{ id: 'u1', email: 'a@b.com' }];
    prismaMock.user.findMany.mockResolvedValue(rows);
    await expect(getUsersList()).resolves.toBe(rows);
  });
});
