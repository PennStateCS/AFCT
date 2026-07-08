import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { COURSE_FACULTY_ROLES } from '@/lib/permissions';
import { withCourseAuth } from '@/lib/api/with-auth';

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
 *   401: { description: Not signed in. }
 *   403: { description: Caller is not course faculty or a system admin (TAs excluded). }
 *   404: { description: Course not found. }
 *   500: { description: Server error. }
 */
export const GET = withCourseAuth(
  async (_req, _ctx, { courseId }) => {
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
  },
  { access: 'manage', roles: COURSE_FACULTY_ROLES, deniedAction: 'COURSE_ASSIGNMENTS_ACCESS_DENIED' },
);
