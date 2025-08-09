import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/app/utils/jwt';

// GET: Fetch all published assignments for a course
export async function GET(req: NextRequest, context: any) {
  // Await params if it is a Promise
  const params = typeof context.params?.then === 'function' ? await context.params : context.params;

  const courseId = params.id;

  // 1. Validate courseId
  if (!courseId) {
    return NextResponse.json({ error: 'Missing course ID' }, { status: 400 });
  }

  // 2. Extract and verify token
  const authHeader = req.headers.get('authorization');
  const token = authHeader?.split(' ')[1];
  const decoded = token ? verifyToken(token) : null;

  if (!decoded) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // 3. Ensure the course exists
    const course = await prisma.course.findUnique({
      where: { id: courseId },
      select: { id: true },
    });

    if (!course) {
      return NextResponse.json({ error: 'Course not found' }, { status: 404 });
    }

    // 4. Fetch all published assignments
    const assignments = await prisma.assignment.findMany({
      where: {
        courseId,
        isPublished: true,
      },
      select: {
        id: true,
        title: true,
        dueDate: true,
      },
      orderBy: {
        dueDate: 'asc',
      },
    });

    return NextResponse.json(assignments);
  } catch (error) {
    console.error('API GET ASSIGNMENTS error:', error);
    return NextResponse.json({ error: 'Failed to fetch assignments.' }, { status: 500 });
  }
}
