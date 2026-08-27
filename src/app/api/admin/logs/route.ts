import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { logThrottledView } from '@/lib/api/activity';
import { withAdminAuth } from '@/lib/api/with-auth';
import { parsePageParams } from '@/lib/api/request';
import { LOG_CATEGORIES, LOG_SEVERITIES, pickLogValues } from '@/lib/activity-log-values';
import type { Prisma } from '@prisma/client';

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

// Build a display name from the parts we have, falling back to email, then id.
function displayName(u: {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
}): string {
  const name = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
  return name || u.email || u.id;
}

/**
 * A single page of activity (audit) logs, newest first, with the author's name resolved
 * alongside the id rather than in place of it. `userId` is the real id; see the mapping to
 * the author's display name. Search, severity filter, and sort all run server-side.
 * @openapi
 * summary: List activity (audit) logs
 * parameters:
 *   - { name: page, in: query, schema: { type: integer, minimum: 1, default: 1 } }
 *   - { name: pageSize, in: query, schema: { type: integer, minimum: 1, maximum: 200, default: 50 } }
 *   - { name: q, in: query, description: "Match on action, category, or author name/email", schema: { type: string } }
 *   - { name: field, in: query, description: "Restrict the search to one field", schema: { type: string, enum: [all, action, category, name, email] } }
 *   - { name: severity, in: query, description: "Repeatable; filters to any of the given levels", schema: { type: array, items: { type: string, enum: [INFO, WARNING, ERROR, SECURITY] } } }
 *   - { name: category, in: query, description: "Repeatable; filters to any of the given categories", schema: { type: array, items: { type: string, enum: [SYSTEM, USER, COURSE, ASSIGNMENT, PROBLEM, SUBMISSION, GRADE] } } }
 *   - { name: sortBy, in: query, schema: { type: string, enum: [timestamp, severity, category, action, ipAddress, userLastName, userFirstName] } }
 *   - { name: sortDir, in: query, schema: { type: string, enum: [asc, desc], default: desc } }
 * responses:
 *   200:
 *     description: One page of logs.
 *     content:
 *       application/json:
 *         schema:
 *           type: object
 *           properties:
 *             rows: { type: array, items: { type: object }, description: ActivityLog rows; userId is the resolved author name }
 *             total: { type: integer }
 *             page: { type: integer }
 *             pageSize: { type: integer }
 *             totalPages: { type: integer }
 *   403: { description: Caller is not a system administrator. }
 *   500: { description: Query failed. }
 */
export const GET = withAdminAuth(
  async (req: Request, _ctx: unknown, { user }) => {
    try {
      const url = new URL(req.url);
      const { page, pageSize, skip, take } = parsePageParams(url.searchParams, {
        defaultSize: DEFAULT_PAGE_SIZE,
        maxSize: MAX_PAGE_SIZE,
      });
      // Hoisted: when a search resolves to particular people, the entry recording this read
      // says so, and opens its own throttle window. Browsing the log and narrowing it to one
      // student are different acts and the record has to be able to tell them apart.
      const aboutUserIds: string[] = [];
      const q = (url.searchParams.get('q') ?? '').trim();
      // Optional search scope: restrict the text search to one field. Default: all.
      const FIELDS = ['all', 'action', 'category', 'name', 'email'] as const;
      const fieldRaw = (url.searchParams.get('field') ?? 'all').trim().toLowerCase();
      const field = FIELDS.find((f) => f === fieldRaw) ?? 'all';

      // Severity and category are multi-select (repeated query params). Keep only the
      // known values, in canonical order.
      const severities = pickLogValues(url.searchParams.getAll('severity'), LOG_SEVERITIES);
      const categories = pickLogValues(url.searchParams.getAll('category'), LOG_CATEGORIES);

      // Combine the (optional, scoped) text search and the filters.
      const conditions: Prisma.ActivityLogWhereInput[] = [];
      if (q) {
        const wantAction = field === 'all' || field === 'action';
        const wantCategory = field === 'all' || field === 'category';
        const wantName = field === 'all' || field === 'name';
        const wantEmail = field === 'all' || field === 'email';

        const clauses: Prisma.ActivityLogWhereInput[] = [];
        if (wantAction) clauses.push({ action: { contains: q, mode: 'insensitive' } });
        if (wantCategory) clauses.push({ category: { contains: q, mode: 'insensitive' } });
        if (wantName || wantEmail) {
          // userId is an id, so resolve author matches to ids first.
          const userOr: Prisma.UserWhereInput[] = [];
          if (wantName) {
            userOr.push(
              { firstName: { contains: q, mode: 'insensitive' } },
              { lastName: { contains: q, mode: 'insensitive' } },
            );
          }
          if (wantEmail) userOr.push({ email: { contains: q, mode: 'insensitive' } });
          const matchingUsers = await prisma.user.findMany({
            where: { OR: userOr },
            select: { id: true },
          });
          const ids = matchingUsers.map((u) => u.id);
          aboutUserIds.push(...ids);
          if (ids.length) clauses.push({ userId: { in: ids } });
        }
        // If a scoped search found nothing to match on (e.g. name scope, no such user),
        // return no rows rather than silently ignoring the scope.
        conditions.push(clauses.length ? { OR: clauses } : { id: { in: [] } });
      }
      if (severities.length) conditions.push({ severity: { in: severities } });
      if (categories.length) conditions.push({ category: { in: categories } });
      const where: Prisma.ActivityLogWhereInput = conditions.length ? { AND: conditions } : {};

      // Sorting: only known columns are allowed. `userId` sorts by the author's
      // name (the column shows the resolved name, not the id). Default: newest first.
      const sortDir: 'asc' | 'desc' = url.searchParams.get('sortDir') === 'asc' ? 'asc' : 'desc';
      const sortBy = url.searchParams.get('sortBy') ?? '';
      const ORDER_BY: Record<string, Prisma.ActivityLogOrderByWithRelationInput> = {
        timestamp: { timestamp: sortDir },
        severity: { severity: sortDir },
        category: { category: sortDir },
        action: { action: sortDir },
        ipAddress: { ipAddress: sortDir },
        userId: { user: { lastName: sortDir } },
        userLastName: { user: { lastName: sortDir } },
        userFirstName: { user: { firstName: sortDir } },
      };
      const orderBy = ORDER_BY[sortBy] ?? { timestamp: 'desc' };

      const [total, logs] = await Promise.all([
        prisma.activityLog.count({ where }),
        prisma.activityLog.findMany({
          where,
          orderBy,
          skip,
          take,
        }),
      ]);

      // Resolve author names for just the users referenced on this page.
      const userIds = [...new Set(logs.map((l) => l.userId).filter((id): id is string => !!id))];
      const users = userIds.length
        ? await prisma.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, firstName: true, lastName: true, email: true },
          })
        : [];
      const lookup = Object.fromEntries(users.map((u) => [u.id, u]));

      /**
       * Names for the records these entries point at.
       *
       * The row already carries `courseId`, `assignmentId` and the rest, and an id on screen is
       * no use to somebody reading an audit trail: "Course ID: cmr7x2..." says nothing that
       * "CMPSC 464, Theory of Computation" does not say better.
       *
       * Batched per page, the same way the author names above are, so this stays four queries
       * whatever the page size rather than four per row.
       */
      const idsOf = (key: 'courseId' | 'assignmentId' | 'problemId' | 'submissionId') => [
        ...new Set(logs.map((l) => l[key]).filter((id): id is string => !!id)),
      ];

      const [courses, assignments, problems] = await Promise.all([
        idsOf('courseId').length
          ? prisma.course.findMany({
              where: { id: { in: idsOf('courseId') } },
              select: { id: true, code: true, name: true },
            })
          : [],
        idsOf('assignmentId').length
          ? prisma.assignment.findMany({
              where: { id: { in: idsOf('assignmentId') } },
              select: { id: true, title: true },
            })
          : [],
        idsOf('problemId').length
          ? prisma.problem.findMany({
              where: { id: { in: idsOf('problemId') } },
              select: { id: true, title: true },
            })
          : [],
      ]);

      const byId = <T extends { id: string }>(rows: T[]) =>
        Object.fromEntries(rows.map((row) => [row.id, row])) as Record<string, T | undefined>;
      const courseById = byId(courses);
      const assignmentById = byId(assignments);
      const problemById = byId(problems);

      const rows = logs.map((log) => {
        const u = log.userId ? lookup[log.userId] : null;
        const course = log.courseId ? courseById[log.courseId] : null;
        const assignment = log.assignmentId ? assignmentById[log.assignmentId] : null;
        const problem = log.problemId ? problemById[log.problemId] : null;
        return {
          ...log,
          /**
           * The id stays an id.
           *
           * It used to be replaced with the person's name, which reads well and destroys the
           * one field an investigation needs: Copy JSON exists so an entry can go into a bug
           * report or a disclosure record, and a name is not an identifier. Two people share a
           * name; nobody shares an id, and a renamed or deleted account leaves the name behind
           * pointing at nothing. The name is still here, under its own key.
           */
          userDisplayName: u ? displayName(u) : null,
          userFirstName: u?.firstName ?? null,
          userLastName: u?.lastName ?? null,
          /**
           * The actor's email, shown under their name in the table.
           *
           * Two people share a name, and on a log that is not a hypothetical: the column exists
           * so a reader can tell which account acted. It is the actor's own address from their
           * account, not whatever `userEmail` an action happened to record in metadata, which is
           * often the SUBJECT of the action rather than the person who did it.
           */
          userEmail: u?.email ?? null,
          /**
           * What the entry is about: the name where there is one, the id where there is not.
           *
           * The relations are `SetNull` on delete, so an id can outlive what it pointed at.
           * Falling back to it rather than to nothing keeps the entry saying it was about
           * *something*, which in an audit trail is the difference between a partial answer and
           * no answer at all.
           */
          related: {
            course: course ? `${course.code}, ${course.name}` : (log.courseId ?? null),
            assignment: assignment?.title ?? log.assignmentId ?? null,
            problem: problem?.title ?? log.problemId ?? null,
            // Submissions have no name of their own; the id is what somebody would search for.
            submission: log.submissionId ?? null,
          },
        };
      });

      /**
       * Who watches the watchers (policy §4). Reading the audit trail is itself a sensitive
       * read, and until now only a REFUSED read was recorded, so an administrator could page
       * through every student's activity and leave nothing behind.
       *
       * Throttled, because this page polls every fifteen seconds with auto-refresh on and
       * would otherwise fill the table with entries about reading the table. `viewKey` is what
       * stops that window swallowing the read that matters most: a log narrowed to ONE person
       * is a different act from browsing the log, so it opens a window of its own.
       *
       * Filters, not results. What was searched for is the disclosure-shaped fact; copying
       * the rows themselves into an entry about reading them would double the exposure.
       */
      await logThrottledView(req, {
        userId: user.id,
        action: 'ADMIN_LOGS_VIEWED',
        category: 'SYSTEM',
        key: aboutUserIds.length > 0 ? `user:${aboutUserIds.slice(0, 5).sort().join(',')}` : null,
        metadata: {
          matched: total,
          ...(q ? { search: q, searchField: field } : {}),
          ...(severities.length ? { severities } : {}),
          ...(categories.length ? { categories } : {}),
          ...(aboutUserIds.length ? { aboutUserIds: aboutUserIds.slice(0, 20) } : {}),
        },
      });

      return NextResponse.json({
        rows,
        total,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      });
    } catch (error) {
      console.error('[LOGS_LIST_GET_ERROR]', error);
      return NextResponse.json({ error: 'Failed to fetch logs' }, { status: 500 });
    }
  },
  { deniedAction: 'ADMIN_LOGS_VIEW_DENIED' },
);
