import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getCoursesListForUser } from '@/lib/courses-list';

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
    const role = session?.user?.role;

    if (!userId || !role) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const courses = await getCoursesListForUser(userId, role);
    return NextResponse.json(courses, { status: 200 });
  } catch (error) {
    console.error('Failed to fetch courses list:', error);
    return NextResponse.json({ message: 'Server error' }, { status: 500 });
  }
}
