import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getUsersList } from '@/lib/users-list';
import { isAdmin } from '@/lib/permissions';

/**
 * Lightweight user list used to refresh the users table without the audit-logging
 * side effect of the main `/api/users` GET. Same admin restriction, but read-only.
 * @openapi
 * summary: List users (lightweight)
 * responses:
 *   200:
 *     description: The users.
 *     content:
 *       application/json:
 *         schema: { type: array, items: { type: object } }
 *   403: { description: Caller is not a system admin. }
 *   500: { description: Server error. }
 */
export async function GET() {
  try {
    const session = await auth();
    if (!isAdmin(session?.user)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const users = await getUsersList();

    return NextResponse.json(users);
  } catch (error) {
    console.error('[USERS_LIST_GET_ERROR]', error);
    return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 });
  }
}
