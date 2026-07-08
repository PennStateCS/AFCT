import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { canManageCourse, COURSE_FACULTY_ROLES } from '@/lib/permissions';

/**
 * Lists a course's published assignments with each one's total and max grade
 * (summed across its problems). Course faculty or a system admin (TAs excluded).
 * @openapi
 * summary: List a course's published assignments
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 * responses:
 *   200:
 *     description: Published assignments with totalGrade and maxGrade.
 *     content:
 *       application/json:
 *         schema: { type: array, items: { type: object } }
 *   400: { description: Missing course id. }
 *   403: { description: Caller is not course faculty or a system admin (TAs excluded). }
 *   404: { description: Course not found. }
 *   500: { description: Server error. }
 */
export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const params = await context.params;
  const courseId = await params.id;

    const session = await auth();
    const user = session?.user;

    if (!(await canManageCourse(user, courseId, COURSE_FACULTY_ROLES))) {
      await createEnhancedActivityLog(prisma, req, {
        userId: session?.user?.id ?? null,
        action: 'COURSE_ASSIGNMENTS_ACCESS_DENIED',
        severity: 'SECURITY',
        metadata: {},
      });
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

  if (!courseId) {
    return NextResponse.json({ error: 'Missing course ID' }, { status: 400 });
  }

  try {
    const course = await prisma.course.findUnique({
      where: { id: courseId },
      select: { id: true },
    });

    if (!course) {
      return NextResponse.json({ error: 'Course not found' }, { status: 404 });
    }

    // Pull each assignment's problems too, to derive total/max grade below.
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
            problemId: true,
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
