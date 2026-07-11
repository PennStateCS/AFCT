import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withClientAuth } from '@/lib/api/with-client-auth';
import { getCoursesListForUser } from '@/lib/courses-list';

/**
 * The signed-in user's courses (slim shape for the client), scoped to the token's
 * user — same visibility as the web app: enrolled, non-deleted courses that are
 * published or where the user is staff.
 * @openapi
 * summary: List my courses (client)
 * responses:
 *   200:
 *     description: The caller's courses.
 *     content:
 *       application/json:
 *         schema:
 *           type: object
 *           properties:
 *             courses: { type: array, items: { type: object } }
 *   401: { description: Missing or invalid token. }
 */
export const GET = withClientAuth(async (_req, _ctx, { user }) => {
  const courses = await getCoursesListForUser(user.id, user.isAdmin ? 'ADMIN' : 'STUDENT');

  // Attach the caller's own role per course (the list shaping collapses a student's
  // own roster entry, so read the roles directly).
  const rosters = await prisma.roster.findMany({
    where: { userId: user.id, courseId: { in: courses.map((c) => c.id) } },
    select: { courseId: true, role: true },
  });
  const roleByCourse = new Map(rosters.map((r) => [r.courseId, r.role]));

  return NextResponse.json({
    courses: courses.map((c) => ({
      id: c.id,
      name: c.name,
      code: c.code,
      semester: c.semester,
      isPublished: c.isPublished,
      isArchived: c.isArchived,
      role: roleByCourse.get(c.id) ?? (user.isAdmin ? 'ADMIN' : null),
    })),
  });
});
