import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withClientAuth } from '@/lib/api/with-client-auth';
import { apiError } from '@/lib/api/http';
import { canAccessCourse } from '@/lib/permissions';
import { getStudentCourseAssignments } from '@/lib/student-assignments';

type RouteCtx = { params: Promise<{ courseId: string }> };

/**
 * A course's **published** assignments and their problems, for the token's user
 * (client screen after picking a course). Includes each problem's type, per-assignment
 * maxPoints/maxSubmissions, the student's grade, attempt count, and latest status;
 * never the answer-key file. A course the caller can't reach is masked as 404.
 * @openapi
 * summary: List a course's assignments + problems (client)
 * parameters:
 *   - { name: courseId, in: path, required: true, schema: { type: string } }
 * responses:
 *   200:
 *     description: Assignments, each with its problems.
 *     content:
 *       application/json:
 *         schema:
 *           type: object
 *           properties:
 *             assignments: { type: array, items: { type: object } }
 *   401: { description: Missing or invalid token. }
 *   404: { description: Course not found or not accessible. }
 */
export const GET = withClientAuth(async (_req, ctx: RouteCtx, { user }) => {
  const { courseId } = await ctx.params;

  // Hide existence from anyone who can't reach the course (not enrolled, or a student
  // on an unpublished course): 404, not 403.
  if (!(await canAccessCourse(user, courseId))) {
    return apiError(404, 'Course not found');
  }

  const [course, assignments] = await Promise.all([
    prisma.course.findUnique({ where: { id: courseId }, select: { timezone: true } }),
    getStudentCourseAssignments(user.id, courseId),
  ]);

  return NextResponse.json({
    // The zone the deadlines below are anchored to, plus the server's clock, so the
    // client can render due dates + accurate countdowns without clock-skew surprises.
    timezone: course?.timezone ?? 'UTC',
    serverTime: new Date().toISOString(),
    assignments: assignments.map((a) => ({
      id: a.id,
      title: a.title,
      description: a.description,
      dueDate: a.dueDate?.toISOString() ?? null,
      allowLateSubmissions: a.allowLateSubmissions,
      lateCutoff: a.lateCutoff?.toISOString() ?? null,
      problems: a.problems.map((p) => ({
        id: p.id,
        title: p.title,
        type: p.type,
        maxPoints: p.maxPoints,
        maxSubmissions: p.maxSubmissions,
        submissionCount: p.submissionCount,
        grade: p.grade,
        status: p.status,
      })),
    })),
  });
});
