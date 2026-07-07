import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getCoursesListForUser } from '@/lib/courses-list';
import { isAdmin } from '@/lib/permissions';

/**
 * Returns the course list scoped to the signed-in user and their role (e.g. a
 * student sees their published enrollments; staff see more). The role-based
 * shaping lives in getCoursesListForUser.
 * @openapi
 * summary: List my courses
 * responses:
 *   200:
 *     description: Courses visible to the caller.
 *     content:
 *       application/json:
 *         schema: { type: array, items: { type: object } }
 *   401: { description: Not signed in. }
 *   500: { description: Server error. }
 */
export async function GET() {
  try {
    const session = await auth();
    const userId = session?.user?.id;

    if (!userId) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    // getCoursesListForUser shapes visibility by role: admins see every course,
    // everyone else only their enrolled, published courses. Map the global admin
    // flag onto that contract (non-admins are treated as students here).
    const courses = await getCoursesListForUser(userId, isAdmin(session.user) ? 'ADMIN' : 'STUDENT');
    return NextResponse.json(courses, { status: 200 });
  } catch (error) {
    console.error('Failed to fetch courses list:', error);
    return NextResponse.json({ message: 'Server error' }, { status: 500 });
  }
}
