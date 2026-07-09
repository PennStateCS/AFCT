import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withCourseAuth } from '@/lib/api/with-auth';

/**
 * Returns just the STUDENT members of a course (user profiles). Course staff
 * (faculty or TAs) or a system admin.
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
 *   401: { description: Not signed in. }
 *   403: { description: Not course staff (faculty or TAs) or a system admin. }
 *   500: { description: Server error. }
 */
export const GET = withCourseAuth(
  async (_req, _ctx, { courseId }) => {
    try {
      // Filter to STUDENT in the query (indexed) rather than fetching every roster
      // row and filtering in JS.
      const rosterEntries = await prisma.roster.findMany({
        where: { courseId, role: 'STUDENT' },
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

      return NextResponse.json(rosterEntries.map((r) => r.user));
    } catch (err) {
      console.error('Failed to fetch students:', err);
      return NextResponse.json({ error: 'Server error' }, { status: 500 });
    }
  },
  { access: 'manage', deniedAction: 'COURSE_STUDENTS_ACCESS_DENIED' },
);
