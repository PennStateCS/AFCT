import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';

// GET: Lightweight function for getting all logs sorted by recency.
export async function GET(req: Request) {
  try {
    const session = await auth();
    if (!session || !['ADMIN', 'FACULTY'].includes(session.user.role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

	const names = await prisma.user.findMany({
		select: {
			id: true,
			firstName: true,
			lastName: true,
		},
	});

	const lookup = Object.fromEntries(
		names.map(obj => [obj.id, obj.firstName + ' ' + obj.lastName])
	);

    var data = await prisma.activityLog.findMany({
      orderBy: {
        timestamp: 'desc',
      },
    });

    const result = data.map(obj => ({
      ...obj,
	  userId: lookup[obj.userId] ?? obj.userId
	}));
	
    return NextResponse.json(result);
  } catch (error) {
    console.error('[LOGS_LIST_GET_ERROR]', error);
    return NextResponse.json({ error: 'Failed to fetch logs' }, { status: 500 });
  }
}

