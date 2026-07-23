import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';

export type UserListItem = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  temporaryPassword: boolean;
  isAdmin: boolean;
  avatar: string | null;
  cropX: number | null;
  cropY: number | null;
  zoom: number | null;
  timezone: string | null;
  inactive: boolean;
  lastLogin: Date | null;
  // Auto-expiring login lock. A future value means the account is locked out; the admin
  // UI shows a countdown and an unlock action. Past/null means not locked.
  lockedUntil: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

// The exact column set the admin users table needs; shared by the full-list and the
// paginated queries so they can never drift.
const USER_LIST_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  temporaryPassword: true,
  isAdmin: true,
  avatar: true,
  cropX: true,
  cropY: true,
  zoom: true,
  timezone: true,
  inactive: true,
  lastLogin: true,
  lockedUntil: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

export async function getUsersList(): Promise<UserListItem[]> {
  return prisma.user.findMany({
    orderBy: [{ lastName: 'asc' }],
    select: USER_LIST_SELECT,
  });
}

// Search scope for the paginated query: 'all' spans the text fields below.
export type UsersSearchField = 'all' | 'firstName' | 'lastName' | 'email';

export type UsersPageParams = {
  skip: number;
  take: number;
  q?: string;
  field?: UsersSearchField;
  // Multi-select filters. Each is a set of the still-allowed values; an empty (or
  // absent) set means "no constraint on this dimension".
  admin?: boolean[]; // isAdmin
  inactive?: boolean[]; // Status (Active = false, Inactive = true)
  temporaryPassword?: boolean[]; // Password Status
  lock?: ('locked' | 'unlocked')[];
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  // Injectable so a caller (or test) can pin "now" for the lock comparison.
  now?: Date;
};

// Sortable columns → Prisma orderBy. Ids match the table's accessorKeys. Anything else
// falls back to lastName. A stable `id` tiebreaker keeps pagination deterministic when
// the primary sort value ties.
const USER_ORDER_BY: Record<string, (dir: 'asc' | 'desc') => Prisma.UserOrderByWithRelationInput> =
  {
    firstName: (dir) => ({ firstName: dir }),
    lastName: (dir) => ({ lastName: dir }),
    email: (dir) => ({ email: dir }),
    isAdmin: (dir) => ({ isAdmin: dir }),
    inactive: (dir) => ({ inactive: dir }),
    temporaryPassword: (dir) => ({ temporaryPassword: dir }),
    createdAt: (dir) => ({ createdAt: dir }),
    lastLogin: (dir) => ({ lastLogin: dir }),
  };

/**
 * One page of the admin users table with search, filters, and sort applied
 * server-side. Returns the rows plus the total matching count (for the pager).
 */
export async function getUsersPage(
  params: UsersPageParams,
): Promise<{ rows: UserListItem[]; total: number }> {
  const now = params.now ?? new Date();
  const and: Prisma.UserWhereInput[] = [];

  if (params.q) {
    const q = params.q;
    const field = params.field ?? 'all';
    const clauses: Prisma.UserWhereInput[] = [];
    if (field === 'all' || field === 'firstName')
      clauses.push({ firstName: { contains: q, mode: 'insensitive' } });
    if (field === 'all' || field === 'lastName')
      clauses.push({ lastName: { contains: q, mode: 'insensitive' } });
    if (field === 'all' || field === 'email')
      clauses.push({ email: { contains: q, mode: 'insensitive' } });
    and.push(clauses.length ? { OR: clauses } : { id: { in: [] } });
  }

  // Boolean multi-selects: exactly one value constrains (equals); both or none is the
  // same as no filter on that dimension. (Prisma has no `in` for boolean fields.)
  if (params.admin?.length === 1) and.push({ isAdmin: params.admin[0] });
  if (params.inactive?.length === 1) and.push({ inactive: params.inactive[0] });
  if (params.temporaryPassword?.length === 1)
    and.push({ temporaryPassword: params.temporaryPassword[0] });
  // Lock is date-derived, so only constrain when exactly one side is selected (both
  // "Locked" and "Not locked" together is the same as no lock filter).
  if (params.lock?.length === 1) {
    and.push(
      params.lock[0] === 'locked'
        ? { lockedUntil: { gt: now } }
        : { OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }] },
    );
  }

  const where: Prisma.UserWhereInput = and.length ? { AND: and } : {};
  const dir: 'asc' | 'desc' = params.sortDir === 'desc' ? 'desc' : 'asc';
  const primary = (USER_ORDER_BY[params.sortBy ?? ''] ?? (() => ({ lastName: dir })))(dir);
  const orderBy: Prisma.UserOrderByWithRelationInput[] = [primary, { id: 'asc' }];

  const [total, rows] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy,
      skip: params.skip,
      take: params.take,
      select: USER_LIST_SELECT,
    }),
  ]);

  return { rows, total };
}
