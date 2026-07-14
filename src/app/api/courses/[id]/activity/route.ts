import { NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { withCourseAuth } from '@/lib/api/with-auth';
import { parseLimitOffset } from '@/lib/api/request';

/**
 * Returns a paginated activity feed for one course: logs tied directly to the
 * course plus its assignments, problems, submissions, and recent logins by course
 * members. Any enrolled member of the course (any role) or a system admin.
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
        select: { id: true },
      });

      if (!course) {
        return NextResponse.json({ error: 'Course not found' }, { status: 404 });
      }

      // Get URL search params for pagination
      const { searchParams } = new URL(request.url);
      const { limit, offset } = parseLimitOffset(searchParams, { defaultLimit: 50, maxLimit: 200 });

      // Precompute the 24h login window and the course's roster user ids once, then
      // reuse a single WHERE for both the page query and the count. Previously the
      // clause was duplicated verbatim and used a correlated per-row rosterEntries
      // subquery to find member logins; an `userId IN (...)` on the precomputed set
      // is a plain indexed lookup instead.
      const loginSince = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const rosterUserIds = (
        await prisma.roster.findMany({ where: { courseId }, select: { userId: true } })
      ).map((r) => r.userId);

      const where: Prisma.ActivityLogWhereInput = {
        OR: [
          // Direct course activities (indexed foreign key).
          { courseId },
          // Assignment / problem / submission activities within this course.
          { assignment: { courseId } },
          { problem: { courseId } },
          { submission: { assignmentProblem: { assignment: { courseId } } } },
          // Recent logins by course members (last 24h).
          {
            AND: [
              { action: { contains: 'LOGIN' } },
              { timestamp: { gte: loginSince } },
              { userId: { in: rosterUserIds } },
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
