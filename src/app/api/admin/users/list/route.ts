import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getUsersList } from '@/lib/users-list';
import { isAdmin } from '@/lib/permissions';

/**
 * Lightweight user list used to refresh the users table without the audit-logging
 * side effect of the main `/api/users` GET. Same staff-role restriction and role
 * filter, but read-only.
 * @openapi
 * summary: List users (lightweight)
 * parameters:
 *   - { name: role, in: query, description: Filter to a single role, schema: { type: string, enum: [STUDENT, TA, FACULTY, ADMIN] } }
 * responses:
 *   200:
 *     description: Users (optionally filtered by role).
 *     content:
 *       application/json:
 *         schema: { type: array, items: { type: object } }
 *   403: { description: Caller lacks a staff role. }
 *   500: { description: Server error. }
 */
export async function GET(req: Request) {
  try {
    const session = await auth();
    if (!isAdmin(session?.user)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const role = searchParams.get('role');
    const users = await getUsersList(role);

    return NextResponse.json(users);
  } catch (error) {
    console.error('[USERS_LIST_GET_ERROR]', error);
    return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 });
  }
}
