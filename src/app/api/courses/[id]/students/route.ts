import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withCourseAuth } from '@/lib/api/with-auth';
import { ACTIVE_STUDENT_ROSTER } from '@/lib/roster-status';

/**
 * Returns the STUDENT members of a course (user profiles, each tagged with its
 * `enrollmentStatus`). Course staff (faculty or TAs) or a system admin.
 *
 * By default only ACTIVE (ENROLLED) students are returned, since the main caller is the
 * assignment-audience picker, where a dropped student must not be offered as a new
 * target. Pass `?includeDropped=1` to also return dropped students (for staff review
 * surfaces like the submissions view, which show them labeled).
 * @openapi
 * summary: List a course's students
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 *   - name: includeDropped
 *     in: query
 *     required: false
 *     description: '"1"/"true" also returns dropped students (default: enrolled only).'
 *     schema: { type: string }
 * responses:
 *   200:
 *     description: The course's students, each with an enrollmentStatus.
 *     content:
 *       application/json:
 *         schema: { type: array, items: { type: object } }
 *   401: { description: Not signed in. }
 *   403: { description: Not course staff (faculty or TAs) or a system admin. }
 *   500: { description: Server error. }
 */
export const GET = withCourseAuth(
  async (req, _ctx, { courseId }) => {
    try {
      const includeDropped = /^(1|true)$/i.test(
        new URL(req.url).searchParams.get('includeDropped') ?? '',
      );
      // Filtered in the query (indexed) rather than fetching every roster row and
      // filtering in JS. `role: 'STUDENT'` for the include-dropped case; the active
      // fragment (role + ENROLLED) otherwise.
      const rosterEntries = await prisma.roster.findMany({
        where: includeDropped
          ? { courseId, role: 'STUDENT' as const }
          : { courseId, ...ACTIVE_STUDENT_ROSTER },
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

      return NextResponse.json(
        rosterEntries.map((r) => ({ ...r.user, enrollmentStatus: r.status })),
      );
    } catch (err) {
      console.error('Failed to fetch students:', err);
      return NextResponse.json({ error: 'Server error' }, { status: 500 });
    }
  },
  { access: 'manage', deniedAction: 'COURSE_STUDENTS_ACCESS_DENIED' },
);
