import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';

const DEFAULT_LIMIT = 1000;
const MAX_LIMIT = 5000;

// Build a display name from the parts we have, falling back to email, then id.
function displayName(u: {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
}): string {
  const name = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
  return name || u.email || u.id;
}

// GET: the most recent activity logs, newest first, with userId resolved to a name.
export async function GET(req: Request) {
  try {
    const session = await auth();
    if (!session || !['ADMIN', 'FACULTY'].includes(session.user.role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // Bound the query so the log table can't be pulled in its entirety.
    const requested = Number(new URL(req.url).searchParams.get('limit'));
    const limit =
      Number.isFinite(requested) && requested > 0 ? Math.min(requested, MAX_LIMIT) : DEFAULT_LIMIT;

    const logs = await prisma.activityLog.findMany({
      orderBy: { timestamp: 'desc' },
      take: limit,
    });

    // Resolve author names for just the users referenced in this page of logs.
    const userIds = [...new Set(logs.map((l) => l.userId).filter((id): id is string => !!id))];
    const users = userIds.length
      ? await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, firstName: true, lastName: true, email: true },
        })
      : [];
    const lookup = Object.fromEntries(users.map((u) => [u.id, displayName(u)]));

    const result = logs.map((log) => ({
      ...log,
      userId: log.userId ? (lookup[log.userId] ?? log.userId) : log.userId,
    }));

    return NextResponse.json(result);
  } catch (error) {
    console.error('[LOGS_LIST_GET_ERROR]', error);
    return NextResponse.json({ error: 'Failed to fetch logs' }, { status: 500 });
  }
}
