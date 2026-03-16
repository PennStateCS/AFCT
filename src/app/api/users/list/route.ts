import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getUsersList } from '@/lib/users-list';

// GET: Lightweight users list for users table refreshes.
export async function GET(req: Request) {
  try {
    const session = await auth();
    if (!session || !['ADMIN', 'FACULTY', 'TA'].includes(session.user.role)) {
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
