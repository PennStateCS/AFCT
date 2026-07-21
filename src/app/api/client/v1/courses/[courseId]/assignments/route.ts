import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withClientAuth } from '@/lib/api/with-client-auth';
import { apiError } from '@/lib/api/http';
import { canAccessCourse, canManageCourse, isAdmin } from '@/lib/permissions';
import { getStudentCourseAssignments } from '@/lib/student-assignments';

type RouteCtx = { params: Promise<{ courseId: string }> };

/**
 * A course's assignments and their problems, scoped by the caller's role in the
 * course (which they must be able to access, else 404):
 *   - Admin / course staff (Faculty, TA): every assignment, published or not.
 *   - Student: only published assignments they are assigned, and only once past the
 *     assignment's available ("unlock") date if one is set. Pre-unlock assignments
 *     are withheld entirely.
 * Each assignment also reports whether it is an individual or group assignment, the
 * caller's group name when it is a group assignment they belong to, and whether late
 * submissions are accepted. The answer-key file is never included.
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

  // Staff (admin or course FACULTY/TA) see every assignment; students see only the
  // published ones assigned to them.
  const staff = isAdmin(user) || (await canManageCourse(user, courseId));

  const [course, all] = await Promise.all([
    prisma.course.findUnique({ where: { id: courseId }, select: { timezone: true } }),
    getStudentCourseAssignments(
      user.id,
      courseId,
      staff ? { includeUnpublished: true, includeUnassigned: true } : {},
    ),
  ]);

  // A student may not see an assignment before its available date; staff always may.
  const assignments = staff ? all : all.filter((a) => !a.locked);

  // Resolve the caller's own group name for each group assignment (group iff the
  // assignment has a group set). One query for all sets at once; staff members are
  // not student group members, so they simply get no group name.
  const groupSetIds = [
    ...new Set(assignments.map((a) => a.groupSetId).filter((id): id is string => id != null)),
  ];
  const memberships = groupSetIds.length
    ? await prisma.groupMembership.findMany({
        where: { userId: user.id, groupSetId: { in: groupSetIds } },
        select: { groupSetId: true, group: { select: { name: true } } },
      })
    : [];
  const groupNameBySet = new Map(memberships.map((m) => [m.groupSetId, m.group.name]));

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
      // Individual vs group assignment, and the caller's group name when applicable.
      isGroup: a.groupSetId != null,
      groupName: a.groupSetId ? (groupNameBySet.get(a.groupSetId) ?? null) : null,
      problems: a.problems.map((p) => ({
        id: p.id,
        title: p.title,
        description: p.description,
        type: p.type,
        maxStates: p.maxStates,
        isDeterministic: p.isDeterministic,
        maxPoints: p.maxPoints,
        maxSubmissions: p.maxSubmissions,
        submissionCount: p.submissionCount,
        grade: p.grade,
        status: p.status,
        // Full marks earned (autograde fans a correct grade out to every group member).
        solved: p.grade != null && p.maxPoints > 0 && p.grade >= p.maxPoints,
      })),
    })),
  });
});
