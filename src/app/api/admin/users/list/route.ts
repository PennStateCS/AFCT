import { NextResponse } from 'next/server';
import { getUsersPage, type UsersSearchField } from '@/lib/users-list';
import { withAdminAuth } from '@/lib/api/with-auth';
import { parsePageParams } from '@/lib/api/request';

const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 100;

// Map a repeatable true/false param to the boolean set getUsersPage expects.
function boolSet(values: string[]): boolean[] {
  const set = new Set(values.map((v) => v.trim().toLowerCase()));
  const out: boolean[] = [];
  if (set.has('true')) out.push(true);
  if (set.has('false')) out.push(false);
  return out;
}

/**
 * One page of the admin users table. Search, filters, sort, and pagination all run
 * server-side. System administrators only; read-only (no audit-log side effect, unlike
 * `GET /api/admin/users`).
 * @openapi
 * summary: List users (paginated)
 * parameters:
 *   - { name: page, in: query, schema: { type: integer, minimum: 1, default: 1 } }
 *   - { name: pageSize, in: query, schema: { type: integer, minimum: 1, maximum: 100, default: 10 } }
 *   - { name: q, in: query, description: "Match on first name, last name, or email", schema: { type: string } }
 *   - { name: field, in: query, schema: { type: string, enum: [all, firstName, lastName, email] } }
 *   - { name: admin, in: query, description: "Repeatable true/false", schema: { type: array, items: { type: string, enum: [true, false] } } }
 *   - { name: status, in: query, description: "Repeatable", schema: { type: array, items: { type: string, enum: [active, inactive] } } }
 *   - { name: lock, in: query, description: "Repeatable", schema: { type: array, items: { type: string, enum: [locked, unlocked] } } }
 *   - { name: temp, in: query, description: "Repeatable true/false", schema: { type: array, items: { type: string, enum: [true, false] } } }
 *   - { name: sortBy, in: query, schema: { type: string, enum: [firstName, lastName, email, isAdmin, inactive, temporaryPassword, createdAt, lastLogin] } }
 *   - { name: sortDir, in: query, schema: { type: string, enum: [asc, desc], default: asc } }
 * responses:
 *   200:
 *     description: One page of users.
 *     content:
 *       application/json:
 *         schema:
 *           type: object
 *           properties:
 *             rows: { type: array, items: { type: object } }
 *             total: { type: integer }
 *             page: { type: integer }
 *             pageSize: { type: integer }
 *             totalPages: { type: integer }
 *   403: { description: Caller is not a system admin. }
 *   500: { description: Server error. }
 */
export const GET = withAdminAuth(
  async (req) => {
    try {
      const url = new URL(req.url);
      const { page, pageSize, skip, take } = parsePageParams(url.searchParams, {
        defaultSize: DEFAULT_PAGE_SIZE,
        maxSize: MAX_PAGE_SIZE,
      });

      const q = (url.searchParams.get('q') ?? '').trim();
      const FIELDS: UsersSearchField[] = ['all', 'firstName', 'lastName', 'email'];
      const fieldRaw = (url.searchParams.get('field') ?? 'all').trim();
      const field = FIELDS.find((f) => f === fieldRaw) ?? 'all';

      // Multi-select filters (repeatable params).
      const admin = boolSet(url.searchParams.getAll('admin'));
      const temporaryPassword = boolSet(url.searchParams.getAll('temp'));
      // Status uses active/inactive tokens; inactive === true.
      const statusValues = new Set(
        url.searchParams.getAll('status').map((v) => v.trim().toLowerCase()),
      );
      const inactive: boolean[] = [];
      if (statusValues.has('inactive')) inactive.push(true);
      if (statusValues.has('active')) inactive.push(false);
      const lock = url.searchParams
        .getAll('lock')
        .map((v) => v.trim().toLowerCase())
        .filter((v): v is 'locked' | 'unlocked' => v === 'locked' || v === 'unlocked');

      const sortDir: 'asc' | 'desc' = url.searchParams.get('sortDir') === 'desc' ? 'desc' : 'asc';
      const sortBy = url.searchParams.get('sortBy') ?? undefined;

      const { rows, total } = await getUsersPage({
        skip,
        take,
        q: q || undefined,
        field,
        admin,
        inactive,
        temporaryPassword,
        lock,
        sortBy,
        sortDir,
      });

      return NextResponse.json({
        rows,
        total,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      });
    } catch (error) {
      console.error('[USERS_LIST_GET_ERROR]', error);
      return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 });
    }
  },
  { deniedAction: 'ADMIN_USERS_LIST_DENIED' },
);
