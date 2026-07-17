import { NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { withCourseAuth } from '@/lib/api/with-auth';
import { parseLimitOffset } from '@/lib/api/request';

/**
 * Returns a paginated activity feed for one course: course/assignment/problem/
 * submission activity plus member logins. Course-content activity by admins (even if
 * not enrolled) and enrolled staff (Faculty/TA) shows any time — so an admin creating
 * or editing a problem before the term is included — while other members' content and
 * all member logins are clipped to the course's start/end dates. Admin logins are never
 * shown (only their course edits). Staff-only to read (see access gate below).
 * @openapi
 * summary: Get a course's activity feed
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 *   - { name: limit, in: query, schema: { type: integer, default: 50 } }
 *   - { name: offset, in: query, schema: { type: integer, default: 0 } }
 * responses:
 *   200:
 *     description: A page of activity entries with a total count.
 *     content:
 *       application/json:
 *         schema:
 *           type: object
 *           properties:
 *             activities: { type: array, items: { type: object } }
 *             totalCount: { type: integer }
 *             hasMore: { type: boolean }
 *   401: { description: Not signed in. }
 *   403: { description: Not enrolled in the course and not a system admin. }
 *   404: { description: Course not found. }
 *   500: { description: Server error. }
 */
export const GET = withCourseAuth(
  async (request, _ctx, { courseId }) => {
    try {
      const course = await prisma.course.findFirst({
        where: { id: courseId },
        select: { id: true, startDate: true, endDate: true },
      });

      if (!course) {
        return NextResponse.json({ error: 'Course not found' }, { status: 404 });
      }

      // Get URL search params for pagination
      const { searchParams } = new URL(request.url);
      const { limit, offset } = parseLimitOffset(searchParams, { defaultLimit: 50, maxLimit: 200 });

      // Roster membership drives visibility: the feed only shows activity by users
      // enrolled in this course. Staff (Faculty/TA, or enrolled site admins) may also
      // show course-content activity *outside* the course dates — e.g. a faculty member
      // authoring a problem before the term starts, or grading after it ends — while
      // everyone else (and all logins) are clipped to the course's start/end window.
      const roster = await prisma.roster.findMany({
        where: { courseId },
        select: { userId: true, role: true },
      });
      const rosterUserIds = roster.map((r) => r.userId);
      const staffUserIds = roster
        .filter((r) => r.role === 'FACULTY' || r.role === 'TA')
        .map((r) => r.userId);

      // Within the course's start/end dates (inclusive).
      const inCourseDates: Prisma.ActivityLogWhereInput = {
        timestamp: { gte: course.startDate, lte: course.endDate },
      };

      // "Directly related to the course": linked to the course or one of its
      // assignments / problems / submissions (bare logins and system events are not).
      const courseLinked: Prisma.ActivityLogWhereInput = {
        OR: [
          { courseId },
          { assignment: { courseId } },
          { problem: { courseId } },
          { submission: { assignmentProblem: { assignment: { courseId } } } },
        ],
      };

      const where: Prisma.ActivityLogWhereInput = {
        OR: [
          // Course-content activity. Admins (even if not enrolled) and enrolled staff
          // show any time; other enrolled members only within the course dates — this is
          // what surfaces "an admin edited this assignment/problem before the term".
          {
            AND: [
              courseLinked,
              {
                OR: [
                  { user: { isAdmin: true } },
                  { userId: { in: staffUserIds } },
                  { AND: [{ userId: { in: rosterUserIds } }, inCourseDates] },
                ],
              },
            ],
          },
          // Logins: enrolled members within the dates, but never admins — their logins
          // are noise here, only their course edits are relevant.
          {
            AND: [
              { action: { contains: 'LOGIN' } },
              { userId: { in: rosterUserIds } },
              { user: { isAdmin: false } },
              inCourseDates,
            ],
          },
        ],
      };

      // Page query + count run in parallel (they were sequential awaits).
      const [activityLogs, totalCount] = await Promise.all([
        prisma.activityLog.findMany({
          where,
          include: {
            user: {
              select: { id: true, email: true, firstName: true, lastName: true, avatar: true },
            },
            course: { select: { id: true, name: true, code: true } },
            assignment: { select: { id: true, title: true } },
            problem: { select: { id: true, title: true } },
            submission: {
              select: {
                id: true,
                assignmentProblem: { select: { assignment: { select: { title: true } } } },
              },
            },
          },
          orderBy: { timestamp: 'desc' },
          take: limit,
          skip: offset,
        }),
        prisma.activityLog.count({ where }),
      ]);

      return NextResponse.json({
        activities: activityLogs,
        totalCount,
        hasMore: offset + limit < totalCount,
      });
    } catch (error) {
      console.error('Error fetching activity logs:', error);
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
  },
  // Staff-only: the course activity feed exposes every member's events plus their
  // names/emails, so students (who may only see their own data) must not read it.
  { access: 'manage', deniedAction: 'COURSE_ACTIVITY_ACCESS_DENIED' },
);
