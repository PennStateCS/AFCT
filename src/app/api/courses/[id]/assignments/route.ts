import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, JwtPayload } from '@/app/utils/jwt';

// GET: Fetch all published assignments for a course
export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  // Await params
  const params = await context.params;
  const courseId = await params.id;

  // 1. Validate courseId
  if (!courseId) {
    return NextResponse.json({ error: 'Missing course ID' }, { status: 400 });
  }

  try {
    // 2. Ensure the course exists
    const course = await prisma.course.findUnique({
      where: { id: courseId },
      select: { id: true },
    });

    if (!course) {
      return NextResponse.json({ error: 'Course not found' }, { status: 404 });
    }

    // 3. Fetch all published assignments along with problem info needed to
    //    compute a student’s total and max grade.  We select the nested
    //    `problems` relation in order to sum `maxPoints` and any existing
    //    `AssignmentProblemGrade` for the current user.
    const assignments = await prisma.assignment.findMany({
      where: {
        courseId: courseId,
        isPublished: true,
      },
      select: {
        id: true,
        title: true,
        dueDate: true,
        description: true,
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
