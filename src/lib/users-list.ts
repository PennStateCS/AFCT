import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';

export type UserListItem = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  temporaryPassword: boolean;
  /**
   * Whether the account has an AFCT password at all. The fact only, never the hash.
   *
   * An account created by an institutional sign-in or an LMS launch has none, and
   * `temporaryPassword` cannot say so: it is false for those, exactly as it is for an ordinary
   * account with a password the person chose. Reading the two together is what lets the table
   * tell "normal" from "there is nothing here".
   */
  hasPassword: boolean;
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
  // Reduced to a boolean by `toListItem` and then dropped. See the warning there.
  password: true,
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

type UserListRow = Prisma.UserGetPayload<{ select: typeof USER_LIST_SELECT }>;

/**
 * Turn a queried row into what the admin table receives.
 *
 * **The hash is destructured out, not spread over.** This payload is serialised straight to the
 * browser, so `{ ...row, hasPassword }` would put every user's bcrypt hash on an administrator's
 * screen. Nothing reads it, which is exactly why it would go unnoticed.
 */
function toListItem(row: UserListRow): UserListItem {
  const { password, ...rest } = row;
  return { ...rest, hasPassword: Boolean(password) };
}

export async function getUsersList(): Promise<UserListItem[]> {
  const rows = await prisma.user.findMany({
    orderBy: [{ lastName: 'asc' }],
    select: USER_LIST_SELECT,
  });
  return rows.map(toListItem);
}

/**
 * The three states the Password Status column can show, and what each means in the database.
 *
 * They are mutually exclusive and cover every account, which is what lets the filter treat a
 * full selection as no filter at all.
 */
export type PasswordStatus = 'temporary' | 'normal' | 'none';

const PASSWORD_STATUS_WHERE: Record<PasswordStatus, Prisma.UserWhereInput> = {
  // An administrator issued it and the person must replace it at next sign-in.
  temporary: { password: { not: null }, temporaryPassword: true },
  // A password the account holder chose.
  normal: { password: { not: null }, temporaryPassword: false },
  // No AFCT password: the account signs in through an institution or an LMS instead.
  none: { password: null },
};

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
  /**
   * Password Status, which is three things rather than two now: an account may have a password
   * it chose, one an administrator issued, or none at all.
   */
  passwordStatus?: PasswordStatus[];
  lock?: ('locked' | 'unlocked')[];
  // Leave out anyone already on this course's roster. Backs the course Enroll dialog, which
  // must not offer someone who is already a member; asking the database keeps that correct
  // now that the client no longer holds the whole roster to subtract.
  excludeCourseId?: string;
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
    // Sorting the Password Status column. Ordered by whether a password exists first, so the
    // "No password" rows group together rather than being scattered through "Normal".
    temporaryPassword: (dir) => ({ password: dir }),
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
  /**
   * Password Status. Selecting every option is the same as selecting none, so an empty or
   * complete set constrains nothing; anything between is an OR over the chosen states.
   */
  if (params.passwordStatus?.length && params.passwordStatus.length < 3) {
    const clauses = params.passwordStatus.map((state) => PASSWORD_STATUS_WHERE[state]);
    and.push(clauses.length === 1 ? clauses[0]! : { OR: clauses });
  }
  // Lock is date-derived, so only constrain when exactly one side is selected (both
  // "Locked" and "Not locked" together is the same as no lock filter).
  if (params.lock?.length === 1) {
    and.push(
      params.lock[0] === 'locked'
        ? { lockedUntil: { gt: now } }
        : { OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }] },
    );
  }

  // Any roster row in that course disqualifies the user, dropped included: a dropped
  // student is still a member, and re-enrolling them is the Manage menu's job, not the
  // Enroll dialog's.
  if (params.excludeCourseId) {
    and.push({ NOT: { rosterEntries: { some: { courseId: params.excludeCourseId } } } });
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

  return { rows: rows.map(toListItem), total };
}
