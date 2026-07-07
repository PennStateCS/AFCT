import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { canManageCourse } from '@/lib/permissions';

/**
 * Returns just the STUDENT members of a course (user profiles). Staff only
 * (ADMIN/FACULTY/TA).
 * @openapi
 * summary: List a course's students
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 * responses:
 *   200:
 *     description: The course's students.
 *     content:
 *       application/json:
 *         schema: { type: array, items: { type: object } }
 *   403: { description: Caller lacks a staff role. }
 *   500: { description: Server error. }
 */
export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  const { id: courseId } = await context.params;

  try {
    const session = await auth();

    if (!(await canManageCourse(session?.user, courseId))) {
      await createEnhancedActivityLog(prisma, req, {
        userId: session?.user?.id ?? null,
        action: 'COURSE_STUDENTS_ACCESS_DENIED',
        severity: 'SECURITY',
        metadata: {},
      });
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const rosterEntries = await prisma.roster.findMany({
      where: { courseId },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
    });

    const students = rosterEntries.filter((r: (typeof rosterEntries)[number]) => r.role === 'STUDENT').map((r: (typeof rosterEntries)[number]) => r.user);

    return NextResponse.json(students);
  } catch (err) {
    console.error('Failed to fetch students:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
