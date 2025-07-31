import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/app/utils/jwt';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const authHeader = req.headers.get('authorization');
  const token = authHeader?.split(' ')[1];
  const decoded = token ? verifyToken(token) : null;

  if (!decoded) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Verify that the course exists
    const course = await prisma.course.findUnique({
      where: { id: params.id },
      select: { id: true },
    });

    if (!course) {
      return NextResponse.json({ error: 'Course not found' }, { status: 404 });
    }

    const assignments = await prisma.assignment.findMany({
      where: {
        courseId: params.id,
        isPublished: true,
      },
      select: {
        id: true,
        title: true,
        dueDate: true,
      },
      orderBy: { dueDate: 'asc' },
    });

    return NextResponse.json(assignments);
  } catch (error) {
    console.error('API GET ASSIGNMENTS error:', error);
    return NextResponse.json({ error: 'Failed to fetch assignments.' }, { status: 500 });
  }
}
