import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { isAdmin, COURSE_STAFF_ROLES } from '@/lib/permissions';
import type { Prisma } from '@prisma/client';

/**
 * Returns the signed-in user's own started, non-archived courses (id + name),
 * used by pickers that only make sense for courses already underway. Note: the
 * `email` path segment is ignored — results are always scoped to the caller's
 * id, so one user can't enumerate another's courses.
 * @openapi
 * summary: List my started courses
 * parameters:
 *   - name: email
 *     in: path
 *     required: true
 *     description: Ignored; retained for the route shape. Results use the caller's id.
 *     schema: { type: string }
 * responses:
 *   200:
 *     description: The caller's started, non-archived courses.
 *     content:
 *       application/json:
 *         schema:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               id: { type: string }
 *               name: { type: string }
 *   401: { description: Not signed in. }
 *   500: { description: Server error. }
 */
export async function GET(req: Request, context: { params: Promise<{ email: string }> }) {
  const { email } = await context.params;

  if (!email) {
    return NextResponse.json({ error: 'Missing email' }, { status: 400 });
  }

  const session = await auth();
  if (!session?.user || session.user.inactive) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const userId = session.user.id;
    // Course visibility mirrors canAccessCourse: admins see any course they're on;
    // staff (FACULTY/TA) see theirs even while unpublished; students only see a
    // course once it's published. Scoped by the caller's id (not the path email)
    // to prevent enumeration.
    const visibility: Prisma.CourseWhereInput = isAdmin(session.user)
      ? { roster: { some: { userId } } }
      : {
          OR: [
            { isPublished: true, roster: { some: { userId } } },
            { roster: { some: { userId, role: { in: COURSE_STAFF_ROLES } } } },
          ],
        };

    const courses = await prisma.course.findMany({
      where: {
        ...visibility,
        isArchived: false,
        deletedAt: null, // never surface soft-deleted courses
        startDate: { lte: new Date() }, // only courses that have already started
      },
      select: {
        id: true,
        name: true,
      },
    });

    return NextResponse.json(courses, { status: 200 });
  } catch (error) {
    console.error('Failed to fetch courses:', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
