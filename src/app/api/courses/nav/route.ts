import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { isAdmin } from '@/lib/permissions';

/**
 * Compact course list for the sidebar navigation — only the caller's enrolled
 * courses, and for students only the published ones. Returns just the fields the
 * nav needs (id, name, code, publish/archive flags).
 * @openapi
 * summary: List courses for navigation
 * responses:
 *   200:
 *     description: The caller's courses, newest first.
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

    // In the nav a user sees a course if it's published, if they are staff
    // (FACULTY/TA) in that course, or if they are a global admin.
    const courses = await prisma.course.findMany({
      where: {
        roster: { some: { userId } },
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
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json(courses, { status: 200 });
  } catch (error) {
    console.error('Failed to fetch sidebar courses:', error);
    return NextResponse.json({ message: 'Server error' }, { status: 500 });
  }
}
