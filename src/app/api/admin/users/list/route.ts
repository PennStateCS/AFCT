import { NextResponse } from 'next/server';
import { getUsersList } from '@/lib/users-list';
import { withAdminAuth } from '@/lib/api/with-auth';

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
export const GET = withAdminAuth(async () => {
  try {
    const users = await getUsersList();
    return NextResponse.json(users);
  } catch (error) {
    console.error('[USERS_LIST_GET_ERROR]', error);
    return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 });
  }
});
