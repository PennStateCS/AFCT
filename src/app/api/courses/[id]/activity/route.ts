import { NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { withCourseAuth } from '@/lib/api/with-auth';
import { parsePageParams } from '@/lib/api/request';
import { LOG_CATEGORIES, pickLogValues } from '@/lib/activity-log-values';

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

/** Sortable columns to Prisma orderBy. Anything else falls back to newest-first. */
const ACTIVITY_ORDER_BY: Record<
  string,
  (dir: 'asc' | 'desc') => Prisma.ActivityLogOrderByWithRelationInput[]
> = {
  timestamp: (dir) => [{ timestamp: dir }],
  action: (dir) => [{ action: dir }],
  category: (dir) => [{ category: dir }],
  severity: (dir) => [{ severity: dir }],
  ipAddress: (dir) => [{ ipAddress: dir }],
  userLastName: (dir) => [{ user: { lastName: dir } }],
};

const SEARCH_FIELDS = ['all', 'action', 'category', 'user'] as const;

/**
 * One page of a course's activity feed: course/assignment/problem/submission activity plus
 * member logins. Course-content activity by admins (even if not enrolled) and enrolled
 * staff (Faculty/TA) shows any time (so an admin creating or editing a problem before the
 * term is included), while other members' content and all member logins are clipped to the
 * course's start/end dates. Admin logins are never shown (only their course edits).
 * Staff-only to read (see the access gate below).
 *
 * Search, filters, sort and pagination all run in the database. They used to run in the
 * browser over whatever "Load More" had fetched, which meant searching an audit trail could
 * return nothing for an event that existed.
 *
 * `?part=filters` returns the course's assignments and problems so the filter menus can
 * offer every one of them, not just those present in the rows on screen.
 * @openapi
 * summary: Get a page of a course's activity feed
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 *   - name: part
 *     in: query
 *     required: false
 *     description: "`filters` returns the course's assignments and problems for the filter menus."
 *     schema: { type: string, enum: [filters] }
 *   - { name: page, in: query, schema: { type: integer, minimum: 1, default: 1 } }
 *   - { name: pageSize, in: query, schema: { type: integer, minimum: 1, maximum: 200, default: 50 } }
 *   - { name: q, in: query, description: "Match on action, category, or the actor's name/email", schema: { type: string } }
 *   - { name: field, in: query, schema: { type: string, enum: [all, action, category, user] } }
 *   - { name: category, in: query, description: "Repeatable", schema: { type: array, items: { type: string } } }
 *   - { name: assignmentId, in: query, description: "Repeatable", schema: { type: array, items: { type: string } } }
 *   - { name: problemId, in: query, description: "Repeatable", schema: { type: array, items: { type: string } } }
 *   - { name: sortBy, in: query, schema: { type: string, enum: [timestamp, action, category, severity, ipAddress, userLastName] } }
 *   - { name: sortDir, in: query, schema: { type: string, enum: [asc, desc], default: desc } }
 * responses:
 *   200:
 *     description: One page of activity entries, or the filter option lists.
 *     content:
 *       application/json:
 *         schema:
 *           type: object
 *           properties:
 *             rows: { type: array, items: { type: object } }
 *             total: { type: integer }
 *             page: { type: integer }
 *             pageSize: { type: integer }
 *             totalPages: { type: integer }
 *             assignments: { type: array, items: { type: object } }
 *             problems: { type: array, items: { type: object } }
 *   401: { description: Not signed in. }
 *   403: { description: Not course staff (faculty or TAs) or a system admin. }
 *   404: { description: Course not found. }
 *   500: { description: Server error. }
 */
export const GET = withCourseAuth(
  async (request, _ctx, { courseId }) => {
    try {
      const { searchParams } = new URL(request.url);

      if (searchParams.get('part') === 'filters') {
        const [assignments, problems] = await Promise.all([
          prisma.assignment.findMany({
            where: { courseId },
            select: { id: true, title: true },
            orderBy: { title: 'asc' },
          }),
          prisma.problem.findMany({
            where: { courseId },
            select: { id: true, title: true },
            orderBy: { title: 'asc' },
          }),
        ]);
        return NextResponse.json({ assignments, problems });
      }

      const course = await prisma.course.findFirst({
        where: { id: courseId },
        select: { id: true, startDate: true, endDate: true },
      });

      if (!course) {
        return NextResponse.json({ error: 'Course not found' }, { status: 404 });
      }

      const { page, pageSize, skip, take } = parsePageParams(searchParams, {
        defaultSize: DEFAULT_PAGE_SIZE,
        maxSize: MAX_PAGE_SIZE,
      });

      /*
       * Roster membership drives visibility: the feed only shows activity by users enrolled
       * in this course. Staff (Faculty/TA, or enrolled site admins) may also show
       * course-content activity *outside* the course dates -- e.g. a faculty member
       * authoring a problem before the term starts, or grading after it ends -- while
       * everyone else (and all logins) are clipped to the course's start/end window.
       *
       * Expressed as relation filters rather than by reading the whole roster and inlining
       * `userId IN (...)`: same meaning, but a thousand-student course no longer loads its
       * entire roster on every page request.
       */
      const isMember: Prisma.ActivityLogWhereInput = {
        user: { rosterEntries: { some: { courseId } } },
      };
      const isStaff: Prisma.ActivityLogWhereInput = {
        user: { rosterEntries: { some: { courseId, role: { in: ['FACULTY', 'TA'] } } } },
      };

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

      const visibility: Prisma.ActivityLogWhereInput = {
        OR: [
          // Course-content activity. Admins (even if not enrolled) and enrolled staff
          // show any time; other enrolled members only within the course dates. That is
          // what surfaces "an admin edited this assignment/problem before the term".
          {
            AND: [
              courseLinked,
              { OR: [{ user: { isAdmin: true } }, isStaff, { AND: [isMember, inCourseDates] }] },
            ],
          },
          // Logins: enrolled members within the dates, but never admins, whose logins are
          // noise here; only their course edits are relevant.
          {
            AND: [
              { action: { contains: 'LOGIN' } },
              isMember,
              { user: { isAdmin: false } },
              inCourseDates,
            ],
          },
        ],
      };

      // Caller filters AND on top of the visibility rule above; they may narrow what a
      // staff member sees, never widen it.
      const and: Prisma.ActivityLogWhereInput[] = [visibility];

      const q = (searchParams.get('q') ?? '').trim();
      if (q) {
        const fieldRaw = (searchParams.get('field') ?? 'all').trim().toLowerCase();
        const field = SEARCH_FIELDS.find((f) => f === fieldRaw) ?? 'all';
        const like = { contains: q, mode: 'insensitive' } as const;
        const clauses: Prisma.ActivityLogWhereInput[] = [];
        if (field === 'all' || field === 'action') clauses.push({ action: like });
        if (field === 'all' || field === 'category') clauses.push({ category: like });
        if (field === 'all' || field === 'user') {
          clauses.push(
            { user: { firstName: like } },
            { user: { lastName: like } },
            { user: { email: like } },
          );
        }
        // A scoped search that matches nothing returns nothing, rather than silently
        // ignoring the scope.
        and.push(clauses.length ? { OR: clauses } : { id: { in: [] } });
      }

      const categories = pickLogValues(searchParams.getAll('category'), LOG_CATEGORIES);
      if (categories.length > 0) and.push({ category: { in: categories } });

      const assignmentIds = searchParams.getAll('assignmentId').filter(Boolean);
      if (assignmentIds.length > 0) and.push({ assignmentId: { in: assignmentIds } });

      const problemIds = searchParams.getAll('problemId').filter(Boolean);
      if (problemIds.length > 0) and.push({ problemId: { in: problemIds } });

      const where: Prisma.ActivityLogWhereInput = { AND: and };

      const sortDir: 'asc' | 'desc' = searchParams.get('sortDir') === 'asc' ? 'asc' : 'desc';
      const build =
        ACTIVITY_ORDER_BY[searchParams.get('sortBy') ?? ''] ?? (() => [{ timestamp: sortDir }]);
      // A stable tiebreaker keeps paging deterministic when two events share a timestamp.
      const orderBy: Prisma.ActivityLogOrderByWithRelationInput[] = [
        ...build(sortDir),
        { id: 'asc' },
      ];

      // Page query + count run in parallel (they were sequential awaits).
      const [rows, total] = await Promise.all([
        prisma.activityLog.findMany({
          where,
          include: {
            user: {
              select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
                avatar: true,
                cropX: true,
                cropY: true,
                zoom: true,
              },
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
          orderBy,
          take,
          skip,
        }),
        prisma.activityLog.count({ where }),
      ]);

      return NextResponse.json({
        rows,
        total,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
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
