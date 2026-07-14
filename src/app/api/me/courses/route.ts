import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getCoursesListForUser } from '@/lib/courses-list';
import { isAdmin } from '@/lib/permissions';

/**
 * Lists the courses visible to the signed-in user, in one of two shapes selected by
 * the `view` query param:
 *   - default: the full role-scoped list (a student sees their published
 *     enrollments; staff/admins see more), shaped by getCoursesListForUser.
 *   - `view=nav`: a compact list for the sidebar navigation, only the caller's
 *     enrolled courses (published-only for students), with just the fields the nav
 *     needs (id, name, code, publish/archive flags), newest first.
 * @openapi
 * summary: List my courses
 * parameters:
 *   - name: view
 *     in: query
 *     description: '"nav" returns the compact sidebar shape; omit for the full list.'
 *     schema: { type: string, enum: [nav] }
 * responses:
 *   200:
 *     description: Courses visible to the caller (shape depends on `view`).
 *     content:
 *       application/json:
 *         schema: { type: array, items: { type: object } }
 *   401: { description: Not signed in. }
 *   500: { description: Server error. }
 */
export async function GET(req: Request) {
  const session = await auth();
  const userId = session?.user?.id;

  if (!userId || session.user.inactive) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const view = new URL(req.url).searchParams.get('view');

  try {
    if (view === 'nav') {
      // Compact sidebar list. A user sees a course if it's published, if they are
      // staff (FACULTY/TA) in it, or if they are a global admin.
      const courses = await prisma.course.findMany({
        where: {
          roster: { some: { userId } },
          // A soft-deleted course never appears in anyone's navigation.
          deletedAt: null,
          ...(isAdmin(session.user)
            ? {}
            : {
                OR: [
                  { isPublished: true },
                  { roster: { some: { userId, role: { in: ['FACULTY', 'TA'] } } } },
                ],
              }),
        },
        select: {
          id: true,
          name: true,
          code: true,
          isPublished: true,
          isArchived: true,
          startDate: true,
          endDate: true,
        },
        orderBy: { createdAt: 'desc' },
      });

      return NextResponse.json(courses, { status: 200 });
    }

    // Default: the full role-scoped list. getCoursesListForUser shapes visibility by
    // role: admins see every course, everyone else only their enrolled, published
    // courses. Map the global admin flag onto that contract (non-admins are treated
    // as students here).
    const courses = await getCoursesListForUser(
      userId,
      isAdmin(session.user) ? 'ADMIN' : 'STUDENT',
    );
    return NextResponse.json(courses, { status: 200 });
  } catch (error) {
    console.error('Failed to fetch courses list:', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
