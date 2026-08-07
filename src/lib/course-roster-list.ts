import { prisma } from '@/lib/prisma';
import type { Prisma, CourseRole, EnrollmentStatus } from '@prisma/client';
import { studentsWithSubmissions, type OptionalCountDelegate } from '@/lib/course-aggregates';

/**
 * One page of a course's roster, with search, filters and sort applied in the database.
 *
 * The roster used to ship whole inside the course payload, which does not survive a
 * 1,000-student course. Everything here exists to keep one page bounded, including
 * `hasSubmissions`, which is what decides whether a row's Remove button is enabled and
 * used to be computed by crossing every student in the course with every assignment.
 *
 * This is a staff surface: dropped students stay visible and badged, per ANY_STUDENT_ROSTER
 * in `lib/roster-status`. Students never read it (the route is manage-gated).
 */

/** Search scope: 'all' spans every field in `searchClauses`. */
export type RosterSearchField = 'all' | 'name' | 'email';

export type RosterMemberRow = {
  /** The roster row id, not the user id. `id` below is the user, which the columns key on. */
  rosterId: string;
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  avatar: string | null;
  cropX: number | null;
  cropY: number | null;
  zoom: number | null;
  /**
   * The member's COURSE role, named `role` because that is what the roster table's columns
   * read (see RosterUser in user-columns). The Role badge and the Status cell both key off
   * it, so a row that spells it `courseRole` renders a blank badge and a dash.
   */
  role: CourseRole;
  enrollmentStatus: EnrollmentStatus;
  /** Whether this student has work in the course; staff may not remove someone who has. */
  hasSubmissions: boolean;
};

export type RosterPageParams = {
  courseId: string;
  skip: number;
  take: number;
  q?: string;
  field?: RosterSearchField;
  // Multi-selects: the still-allowed values. Empty (or every value) means no constraint.
  roles?: CourseRole[];
  statuses?: EnrollmentStatus[];
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
};

// The exact column set the roster table needs. The crop fields ride along with the avatar:
// leaving them out is what made avatars silently reset to their default framing once the
// tab's fetch replaced the server-rendered rows.
const ROSTER_LIST_SELECT = {
  id: true,
  role: true,
  status: true,
  user: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      avatar: true,
      cropX: true,
      cropY: true,
      zoom: true,
    },
  },
} satisfies Prisma.RosterSelect;

const ALL_ROLES: CourseRole[] = ['FACULTY', 'TA', 'STUDENT'];
const ALL_STATUSES: EnrollmentStatus[] = ['ENROLLED', 'DROPPED'];

/**
 * Sortable columns to Prisma orderBy. Ids match the table's column ids; anything else falls
 * back to surname order, which is how a roster reads and how staff look someone up.
 *
 * `role` orders by the enum's declaration order (FACULTY, TA, STUDENT) rather than
 * alphabetically, which is the seniority order the table already used client-side.
 * Names live on User, so these are join orders; see the index note on User in schema.prisma.
 */
const ROSTER_ORDER_BY: Record<
  string,
  (dir: 'asc' | 'desc') => Prisma.RosterOrderByWithRelationInput[]
> = {
  lastName: (dir) => [{ user: { lastName: dir } }, { user: { firstName: dir } }],
  firstName: (dir) => [{ user: { firstName: dir } }, { user: { lastName: dir } }],
  email: (dir) => [{ user: { email: dir } }],
  role: (dir) => [{ role: dir }, { user: { lastName: 'asc' } }],
  enrollmentStatus: (dir) => [{ status: dir }, { user: { lastName: 'asc' } }],
};

/** Which fields a search scope reaches into. 'all' is the union of the rest. */
function searchClauses(q: string, field: RosterSearchField): Prisma.RosterWhereInput[] {
  const like = { contains: q, mode: 'insensitive' } as const;
  const clauses: Prisma.RosterWhereInput[] = [];
  if (field === 'all' || field === 'name') {
    clauses.push({ user: { firstName: like } }, { user: { lastName: like } });
  }
  if (field === 'all' || field === 'email') clauses.push({ user: { email: like } });
  return clauses;
}

/**
 * One page of the roster plus the total matching count (for the pager).
 *
 * `hasSubmissions` is resolved for the page's students only. It answers "may this person be
 * removed", and removal acts on one row at a time, so there is no reason to ask it of the
 * whole course.
 */
export async function getCourseRosterPage(
  params: RosterPageParams,
): Promise<{ rows: RosterMemberRow[]; total: number }> {
  const and: Prisma.RosterWhereInput[] = [{ courseId: params.courseId }];

  if (params.q) {
    const clauses = searchClauses(params.q, params.field ?? 'all');
    and.push(clauses.length ? { OR: clauses } : { id: { in: [] } });
  }

  // Each multi-select ORs within itself and ANDs with the other, so Role=Student plus
  // Status=Dropped narrows to dropped students rather than returning either group.
  const roles = params.roles ?? [];
  if (roles.length > 0 && roles.length < ALL_ROLES.length) and.push({ role: { in: roles } });

  const statuses = params.statuses ?? [];
  if (statuses.length > 0 && statuses.length < ALL_STATUSES.length) {
    and.push({ status: { in: statuses } });
  }

  const where: Prisma.RosterWhereInput = { AND: and };

  const dir: 'asc' | 'desc' = params.sortDir === 'desc' ? 'desc' : 'asc';
  const build =
    ROSTER_ORDER_BY[params.sortBy ?? ''] ??
    ((d: 'asc' | 'desc') => [{ user: { lastName: d } }, { user: { firstName: d } }]);
  // A stable tiebreaker keeps paging deterministic when two people share a surname, or
  // when the sort column is null (both names are nullable on User).
  const orderBy: Prisma.RosterOrderByWithRelationInput[] = [...build(dir), { id: 'asc' }];

  const [total, rosterRows] = await Promise.all([
    prisma.roster.count({ where }),
    prisma.roster.findMany({
      where,
      orderBy,
      skip: params.skip,
      take: params.take,
      select: ROSTER_LIST_SELECT,
    }),
  ]);

  const studentIds = rosterRows.filter((r) => r.role === 'STUDENT').map((r) => r.user.id);
  let submitted = new Set<string>();
  if (studentIds.length > 0) {
    const assignmentIds = (
      await prisma.assignment.findMany({
        where: { courseId: params.courseId },
        select: { id: true },
      })
    ).map((a) => a.id);

    submitted = await studentsWithSubmissions(
      // Same cast the course route uses: the helper treats the aggregate methods as
      // optional so a partial test mock can fall back to a per-student check.
      prisma.submission as unknown as OptionalCountDelegate,
      studentIds,
      assignmentIds,
      (studentId) =>
        prisma.submission
          .findFirst({
            where: { studentId, assignmentId: { in: assignmentIds } },
            select: { studentId: true },
          })
          .then(Boolean),
    );
  }

  const rows = rosterRows.map((r) => ({
    rosterId: r.id,
    id: r.user.id,
    firstName: r.user.firstName,
    lastName: r.user.lastName,
    email: r.user.email,
    avatar: r.user.avatar,
    cropX: r.user.cropX,
    cropY: r.user.cropY,
    zoom: r.user.zoom,
    role: r.role,
    enrollmentStatus: r.status,
    hasSubmissions: r.role === 'STUDENT' && submitted.has(r.user.id),
  }));

  return { rows, total };
}
