import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { isAdmin } from '@/lib/permissions';

/**
 * Lists the courses the caller may manage, for the "import assignment" picker: courses
 * where they are FACULTY or TA, or every course when they are a system admin. Archived
 * courses are included (you can import from a past term); soft-deleted courses never
 * appear. Pass `excludeCourseId` to drop the course being imported into (importing from
 * the same course is what Duplicate already does).
 *
 * @openapi
 * summary: List courses the caller can manage
 * parameters:
 *   - name: excludeCourseId
 *     in: query
 *     required: false
 *     description: A course id to omit from the list (typically the import destination).
 *     schema: { type: string }
 * responses:
 *   200:
 *     description: Manageable courses (id, name, code, semester, archived flag), active first.
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

  const excludeCourseId = new URL(req.url).searchParams.get('excludeCourseId');

  try {
    const courses = await prisma.course.findMany({
      where: {
        deletedAt: null,
        ...(excludeCourseId ? { id: { not: excludeCourseId } } : {}),
        // Admins see every course; everyone else only courses they staff.
        ...(isAdmin(session.user)
          ? {}
          : { roster: { some: { userId, role: { in: ['FACULTY', 'TA'] } } } }),
      },
      select: {
        id: true,
        name: true,
        code: true,
        semester: true,
        isArchived: true,
      },
      // Active courses first, then newest, so the most likely source is near the top.
      orderBy: [{ isArchived: 'asc' }, { createdAt: 'desc' }],
    });

    return NextResponse.json(courses, { status: 200 });
  } catch (error) {
    console.error('Failed to fetch manageable courses:', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
