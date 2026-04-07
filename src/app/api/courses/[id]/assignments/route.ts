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

  // 2. Extract and verify token
  const authHeader = req.headers.get('authorization');
  const token = authHeader?.split(' ')[1];
  const decoded: JwtPayload | null = token ? verifyToken(token) : null;

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

    // 4. Fetch all published assignments along with problem info needed to
    //    compute a student's total and max grade.
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
        problems: {
          select: {
            maxPoints: true,
            grades: {
              select: { grade: true },
              take: 1,
            },
          },
        },
      },
      orderBy: {
        dueDate: 'asc',
      },
    });

    const result = assignments.map(({ problems, ...assignment }) => {
      const maxGrade = problems.reduce((sum, p) => sum + p.maxPoints, 0);
      const totalGrade = problems.reduce((sum, p) => sum + (p.grades[0]?.grade ?? 0), 0);
      return { ...assignment, totalGrade, maxGrade };
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error('API GET ASSIGNMENTS error:', error);
    return NextResponse.json({ error: 'Failed to fetch assignments.' }, { status: 500 });
  }
}
