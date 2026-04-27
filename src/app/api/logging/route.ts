import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';

// GET: Lightweight function for getting all logs sorted by recency.
export async function GET(req: Request) {
  try {
    const session = await auth();
    if (!session || !['ADMIN', 'FACULTY'].includes(session.user.role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const data = await prisma.activityLog.findMany({
      orderBy: {
        timestamp: 'desc',
      },
    });

    return NextResponse.json(data);
  } catch (error) {
    console.error('[LOGS_LIST_GET_ERROR]', error);
    return NextResponse.json({ error: 'Failed to fetch logs' }, { status: 500 });
  }
}

