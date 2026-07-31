import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  user: {
    findMany: vi.fn(),
    count: vi.fn(),
  },
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { getUsersList, getUsersPage, type UsersPageParams } from '@/lib/users-list';

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.user.findMany.mockResolvedValue([]);
  prismaMock.user.count.mockResolvedValue(0);
});

const args = () => prismaMock.user.findMany.mock.calls[0][0];

describe('getUsersList', () => {
  it('returns all users (no where filter; global role was removed)', async () => {
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

/**
 * The admin users table's server-side page: search, the four multi-select filters, and sort.
 *
 * These are all where-clause shapes rather than results, so they are asserted against the
 * Prisma arguments. The rule that runs through the filters is that a multi-select constrains
 * only when exactly ONE value is selected: selecting both "Admin" and "Not admin" means the
 * same thing as selecting neither, and getting that backwards would quietly hide accounts from
 * an administrator looking for them.
 */
const page = (overrides: Partial<UsersPageParams> = {}) =>
  getUsersPage({ skip: 0, take: 25, ...overrides });

const findArgs = () => prismaMock.user.findMany.mock.calls[0][0];
const countArgs = () => prismaMock.user.count.mock.calls[0][0];

describe('getUsersPage: paging and result shape', () => {
  it('passes skip and take through and returns rows plus the total', async () => {
    prismaMock.user.findMany.mockResolvedValue([{ id: 'u1' }]);
    prismaMock.user.count.mockResolvedValue(97);

    await expect(page({ skip: 50, take: 25 })).resolves.toEqual({
      rows: [{ id: 'u1' }],
      total: 97,
    });
    expect(findArgs()).toMatchObject({ skip: 50, take: 25 });
  });

  it('counts with the same where clause it lists with, so the pager cannot disagree', async () => {
    await page({ q: 'ada', admin: [true] });
    expect(countArgs().where).toEqual(findArgs().where);
  });

  it('applies no filter at all when nothing is asked for', async () => {
    await page();
    expect(findArgs().where).toEqual({});
  });
});

describe('getUsersPage: search', () => {
  it('searches every name field plus email by default', async () => {
    await page({ q: 'ada' });
    expect(findArgs().where).toEqual({
      AND: [
        {
          OR: [
            { firstName: { contains: 'ada', mode: 'insensitive' } },
            { lastName: { contains: 'ada', mode: 'insensitive' } },
            { email: { contains: 'ada', mode: 'insensitive' } },
          ],
        },
      ],
    });
  });

  it.each(['firstName', 'lastName', 'email'] as const)(
    'narrows to %s when asked',
    async (field) => {
      await page({ q: 'ada', field });
      const or = (findArgs().where.AND[0] as { OR: Record<string, unknown>[] }).OR;
      expect(or).toHaveLength(1);
      expect(Object.keys(or[0])[0]).toBe(field);
    },
  );

  it('matches nothing rather than everything when the field is unrecognised', async () => {
    // Defensive: the type says this cannot happen, but a query string can say anything, and
    // silently dropping the search term would show the whole directory instead of no matches.
    await page({ q: 'ada', field: 'nonsense' as UsersPageParams['field'] });
    expect(findArgs().where).toEqual({ AND: [{ id: { in: [] } }] });
  });

  it('ignores an empty search term', async () => {
    await page({ q: '' });
    expect(findArgs().where).toEqual({});
  });
});

describe('getUsersPage: multi-select filters', () => {
  it.each([
    ['admin', 'isAdmin'],
    ['inactive', 'inactive'],
    ['temporaryPassword', 'temporaryPassword'],
  ] as const)('constrains on %s when exactly one value is selected', async (param, column) => {
    await page({ [param]: [true] });
    expect(findArgs().where).toEqual({ AND: [{ [column]: true }] });

    vi.clearAllMocks();
    prismaMock.user.findMany.mockResolvedValue([]);
    prismaMock.user.count.mockResolvedValue(0);
    await page({ [param]: [false] });
    expect(findArgs().where).toEqual({ AND: [{ [column]: false }] });
  });

  it.each(['admin', 'inactive', 'temporaryPassword', 'lock'] as const)(
    'treats both values of %s as no constraint',
    async (param) => {
      const both = param === 'lock' ? (['locked', 'unlocked'] as const) : ([true, false] as const);
      await page({ [param]: both });
      expect(findArgs().where).toEqual({});
    },
  );

  it('reads "locked" as a lock that has not expired yet', async () => {
    const now = new Date('2026-07-31T12:00:00Z');
    await page({ lock: ['locked'], now });
    expect(findArgs().where).toEqual({ AND: [{ lockedUntil: { gt: now } }] });
  });

  it('reads "not locked" as never locked or already expired', async () => {
    const now = new Date('2026-07-31T12:00:00Z');
    await page({ lock: ['unlocked'], now });
    expect(findArgs().where).toEqual({
      AND: [{ OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }] }],
    });
  });

  it('combines search and filters as AND, not OR', async () => {
    await page({ q: 'ada', admin: [true], inactive: [false] });
    expect(findArgs().where.AND).toHaveLength(3);
  });
});

describe('getUsersPage: sort', () => {
  it('defaults to last name ascending', async () => {
    await page();
    expect(findArgs().orderBy).toEqual([{ lastName: 'asc' }, { id: 'asc' }]);
  });

  it.each([
    'firstName',
    'lastName',
    'email',
    'isAdmin',
    'inactive',
    'temporaryPassword',
    'createdAt',
    'lastLogin',
  ])('sorts by %s', async (sortBy) => {
    await page({ sortBy, sortDir: 'desc' });
    expect(findArgs().orderBy).toEqual([{ [sortBy]: 'desc' }, { id: 'asc' }]);
  });

  it('falls back to last name for an unknown column, keeping the requested direction', async () => {
    await page({ sortBy: 'shoeSize', sortDir: 'desc' });
    expect(findArgs().orderBy).toEqual([{ lastName: 'desc' }, { id: 'asc' }]);
  });

  it('treats any direction other than desc as ascending', async () => {
    await page({ sortBy: 'email', sortDir: 'sideways' as UsersPageParams['sortDir'] });
    expect(findArgs().orderBy).toEqual([{ email: 'asc' }, { id: 'asc' }]);
  });

  it('always breaks ties on id, so paging cannot repeat or skip a row', async () => {
    await page({ sortBy: 'isAdmin' });
    expect(findArgs().orderBy[1]).toEqual({ id: 'asc' });
  });
});
