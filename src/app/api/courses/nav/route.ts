import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET() {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    const role = session?.user?.role;

    if (!userId || !role) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const courses = await prisma.course.findMany({
      where: {
        roster: { some: { userId } },
        ...(role === 'STUDENT' ? { isPublished: true } : {}),
      },
      select: {
        id: true,
        name: true,
        code: true,
        isPublished: true,
        isArchived: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json(courses, { status: 200 });
  } catch (error) {
    console.error('Failed to fetch sidebar courses:', error);
    return NextResponse.json({ message: 'Server error' }, { status: 500 });
  }
}
