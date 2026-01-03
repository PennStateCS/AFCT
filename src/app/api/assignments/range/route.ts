import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { start, end } = body;
    if (!start || !end) {
      return NextResponse.json({ error: 'Missing start or end' }, { status: 400 });
    }

    const startDate = new Date(start);
    const endDate = new Date(end);

    // Get course ids the user is enrolled in
    const rosterEntries = await prisma.roster.findMany({ where: { userId: session.user.id }, select: { courseId: true } });
    const courseIds = rosterEntries.map(r => r.courseId);

    if (courseIds.length === 0) return NextResponse.json([], { status: 200 });

    const assignments = await prisma.assignment.findMany({
      where: {
        courseId: { in: courseIds },
        dueDate: {
          gte: startDate,
          lte: endDate,
        },
      },
      include: {
        course: {
          select: { id: true, code: true, name: true },
        },
      },
      orderBy: { dueDate: 'asc' },
    });

    return NextResponse.json(assignments, { status: 200 });
  } catch (error) {
    console.error('Error fetching assignment range:', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
