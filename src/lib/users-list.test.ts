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
  it('does not filter by role (global role removed)', async () => {
    await getUsersList('FACULTY');
    expect(args().where).toBeUndefined();
  });

  it('returns all users (no where filter)', async () => {
    await getUsersList();
    expect(args().where).toBeUndefined();
  });

  it('sorts by last name', async () => {
    await getUsersList();
    expect(args().orderBy).toEqual([{ lastName: 'asc' }]);
  });

  it('passes through the query result', async () => {
    const rows = [{ id: 'u1', email: 'a@b.com' }];
    prismaMock.user.findMany.mockResolvedValue(rows);
    await expect(getUsersList()).resolves.toBe(rows);
  });
});
