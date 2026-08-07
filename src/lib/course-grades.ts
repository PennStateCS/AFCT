import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { isStudentAssigned } from '@/lib/assignment-visibility';

export type GradeMatrixStudent = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  avatar: string | null;
  // Avatar framing (applied as a CSS transform at render); null falls back to default.
  cropX: number | null;
  cropY: number | null;
  zoom: number | null;
  // Enrollment standing, so the gradebook can badge a dropped student. Dropped students
  // stay in the matrix (their grades are retained and still editable by staff).
  enrollmentStatus: string;
};

export type GradeMatrixAssignment = {
  id: string;
  title: string;
  dueDate: Date | null;
  maxPoints: number;
};

// The table structure: who is in the gradebook and which assignments are the columns,
// plus who is assigned what. This is the fast part (no per-problem grade aggregation),
// so the UI can render columns and rows while the grade values are still loading.
export type CourseGradeStructure = {
  students: GradeMatrixStudent[];
  assignments: GradeMatrixAssignment[];
  // assigned[studentId][assignmentId] = whether the student is actually assigned that
  // assignment (assigned to everyone, an individual override, or a group override on a
  // group they belong to). Cells where this is false render as "not assigned".
  assigned: Record<string, Record<string, boolean>>;
};

// The cell values only: grades[studentId][assignmentId] = summed points earned (problem
// grades collapsed), or null. This is the slower part (the grouped aggregation).
export type CourseGradeValues = {
  grades: Record<string, Record<string, number | null>>;
};

export type CourseGradeMatrix = CourseGradeStructure & CourseGradeValues;

/**
 * The gradebook structure for a course: enrolled students, assignments (with the summed
 * max points), and the assigned map. No grade aggregation, so it returns quickly and the
 * UI can paint the columns while `getCourseGradeValues` is still in flight.
 */
export async function getCourseGradeStructure(courseId: string): Promise<CourseGradeStructure> {
  // Every student, dropped included: the gradebook keeps dropped students (labeled) so
  // their retained grades stay visible and editable.
  const roster = await prisma.roster.findMany({
    where: { courseId, role: 'STUDENT' },
    select: { userId: true, status: true },
    orderBy: { createdAt: 'asc' },
  });
  const rosterUserIds = roster.map((r) => r.userId);
  const statusByUser = new Map(roster.map((r) => [r.userId, r.status]));

  const users = rosterUserIds.length
    ? await prisma.user.findMany({
        where: { id: { in: rosterUserIds } },
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
      })
    : [];

  const userMap = new Map(users.map((u) => [u.id, u]));
  const students: GradeMatrixStudent[] = rosterUserIds
    .map((userId) => userMap.get(userId))
    .filter((u): u is NonNullable<typeof u> => !!u)
    .map((u) => ({
      id: u.id,
      firstName: u.firstName,
      lastName: u.lastName,
      email: u.email,
      avatar: u.avatar,
      cropX: u.cropX,
      cropY: u.cropY,
      zoom: u.zoom,
      enrollmentStatus: statusByUser.get(u.id) ?? 'ENROLLED',
    }));

  const assignmentRows = await loadAssignmentRows(courseId);
  const assignments = toColumns(assignmentRows);
  const studentIds = students.map((s) => s.id);
  const assigned = await buildAssignedMap(assignmentRows, studentIds);

  return { students, assignments, assigned };
}

/**
 * The grade values for a course gradebook: each student's summed grade per assignment
 * (null when ungraded). This is the slower half of the matrix, split out so it can be
 * fetched after the structure and merged in as the cells arrive.
 */
export async function getCourseGradeValues(courseId: string): Promise<CourseGradeValues> {
  const roster = await prisma.roster.findMany({
    where: { courseId, role: 'STUDENT' },
    select: { userId: true },
  });
  const studentIds = roster.map((r) => r.userId);
  const assignmentRows = await prisma.assignment.findMany({
    where: { courseId },
    select: { id: true },
  });
  const assignmentIds = assignmentRows.map((a) => a.id);

  const grades: Record<string, Record<string, number | null>> = {};
  for (const s of studentIds) {
    grades[s] = {};
    for (const a of assignmentIds) grades[s][a] = null;
  }

  if (assignmentIds.length === 0 || studentIds.length === 0) {
    return { grades };
  }

  // Sum the per-problem grades into one assignment total per student.
  const gradeRows = await prisma.assignmentProblemGrade.groupBy({
    by: ['studentId', 'assignmentId'],
    where: { assignmentId: { in: assignmentIds }, studentId: { in: studentIds } },
    _sum: { grade: true },
  });

  gradeRows.forEach((g) => {
    const studentGrades = grades[g.studentId];
    if (studentGrades) studentGrades[g.assignmentId] = g._sum.grade ?? 0;
  });

  return { grades };
}

/**
 * The full gradebook matrix (structure + values) for a course.
 *
 * Deliberately unpaginated: the LMS export is its only caller and must cover every student
 * (see `api/courses/[id]/grades/export/route.ts`). The gradebook table does NOT use this;
 * it reads `getCourseGradeColumns` once and then `getCourseGradePage` per page.
 */
export async function getCourseGradeMatrix(courseId: string): Promise<CourseGradeMatrix> {
  const [structure, values] = await Promise.all([
    getCourseGradeStructure(courseId),
    getCourseGradeValues(courseId),
  ]);
  return { ...structure, ...values };
}

// --- Paged gradebook -------------------------------------------------------------
//
// The table reads the course's columns once and then one page of students at a time. The
// functions above stay whole-course because the LMS export needs the entire matrix.

/** The gradebook's columns, plus how many students the course has in total. */
export type CourseGradeColumns = {
  assignments: GradeMatrixAssignment[];
  totalStudents: number;
};

/** One student, with their assigned flags and grades already attached. */
export type GradePageRow = GradeMatrixStudent & {
  assigned: Record<string, boolean>;
  grades: Record<string, number | null>;
};

export type GradePageParams = {
  courseId: string;
  skip: number;
  take: number;
  q?: string;
  /**
   * A student field ('lastName' | 'firstName' | 'email'), the derived 'totalGrade', or an
   * assignment id. Anything else falls back to surname order.
   */
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
};

/** The assignment rows the assigned-map and the columns are both built from. */
type AssignmentRow = {
  id: string;
  title: string;
  dueDate: Date | null;
  assignedToEveryone: boolean;
  problems: { maxPoints: number | null }[];
  assignees: { userId: string | null; groupId: string | null }[];
};

async function loadAssignmentRows(courseId: string): Promise<AssignmentRow[]> {
  return prisma.assignment.findMany({
    where: { courseId },
    select: {
      id: true,
      title: true,
      dueDate: true,
      assignedToEveryone: true,
      problems: { select: { maxPoints: true } },
      assignees: { select: { userId: true, groupId: true } },
    },
    orderBy: { dueDate: 'asc' },
  });
}

function toColumns(rows: AssignmentRow[]): GradeMatrixAssignment[] {
  return rows.map((a) => ({
    id: a.id,
    title: a.title,
    dueDate: a.dueDate,
    maxPoints: a.problems.reduce((sum, p) => sum + Number(p.maxPoints ?? 0), 0),
  }));
}

/**
 * assigned[studentId][assignmentId] for the given students, from already-loaded assignee
 * rows and group memberships. One membership query for the whole set; no per-cell queries.
 *
 * Shared with `getCourseGradeStructure` so "who is assigned what" keeps one definition.
 */
async function buildAssignedMap(
  assignmentRows: AssignmentRow[],
  studentIds: string[],
): Promise<Record<string, Record<string, boolean>>> {
  const assigned: Record<string, Record<string, boolean>> = {};
  for (const s of studentIds) {
    assigned[s] = {};
    for (const a of assignmentRows) assigned[s][a.id] = true;
  }
  if (assignmentRows.length === 0 || studentIds.length === 0) return assigned;

  const memberships = await prisma.groupMembership.findMany({
    where: { userId: { in: studentIds } },
    select: { userId: true, groupId: true },
  });
  const groupIdsByStudent = new Map<string, string[]>();
  for (const m of memberships) {
    const list = groupIdsByStudent.get(m.userId);
    if (list) list.push(m.groupId);
    else groupIdsByStudent.set(m.userId, [m.groupId]);
  }

  for (const a of assignmentRows) {
    for (const s of studentIds) {
      const studentAssigned = assigned[s];
      if (studentAssigned) {
        studentAssigned[a.id] = isStudentAssigned(
          { assignedToEveryone: a.assignedToEveryone },
          a.assignees ?? [],
          s,
          groupIdsByStudent.get(s) ?? [],
        );
      }
    }
  }
  return assigned;
}

/** Dense grades[studentId][assignmentId] for the given students, nulls where ungraded. */
async function loadGradeSums(
  assignmentIds: string[],
  studentIds: string[],
): Promise<Record<string, Record<string, number | null>>> {
  const grades: Record<string, Record<string, number | null>> = {};
  for (const s of studentIds) {
    grades[s] = {};
    for (const a of assignmentIds) grades[s][a] = null;
  }
  if (assignmentIds.length === 0 || studentIds.length === 0) return grades;

  const gradeRows = await prisma.assignmentProblemGrade.groupBy({
    by: ['studentId', 'assignmentId'],
    where: { assignmentId: { in: assignmentIds }, studentId: { in: studentIds } },
    _sum: { grade: true },
  });
  gradeRows.forEach((g) => {
    const studentGrades = grades[g.studentId];
    if (studentGrades) studentGrades[g.assignmentId] = g._sum.grade ?? 0;
  });
  return grades;
}

/**
 * A student's average across their graded work, as a percentage, or undefined when they
 * have none. The server-side twin of the gradebook's Average column: only assignments the
 * student is actually assigned count toward the denominator, so someone who is not assigned
 * everything is not measured against the full course total.
 */
function averagePct(
  assignments: GradeMatrixAssignment[],
  assignedFlags: Record<string, boolean> | undefined,
  studentGrades: Record<string, number | null> | undefined,
): number | undefined {
  let earned = 0;
  let available = 0;
  let gradeCount = 0;
  for (const a of assignments) {
    if (assignedFlags?.[a.id] === false) continue;
    available += a.maxPoints ?? 0;
    const val = studentGrades?.[a.id];
    if (val !== null && val !== undefined) {
      earned += Number(val);
      gradeCount++;
    }
  }
  if (gradeCount === 0 || available === 0) return undefined;
  return (earned / available) * 100;
}

/** The gradebook's columns and its student total. Cached per course by the client. */
export async function getCourseGradeColumns(courseId: string): Promise<CourseGradeColumns> {
  const [assignmentRows, totalStudents] = await Promise.all([
    loadAssignmentRows(courseId),
    prisma.roster.count({ where: { courseId, role: 'STUDENT' } }),
  ]);
  return { assignments: toColumns(assignmentRows), totalStudents };
}

/**
 * One page of the gradebook: students plus their assigned flags and grades.
 *
 * Ordering is resolved here rather than by Prisma, because two of the table's sorts cannot
 * be an `orderBy`: grades live in another table, and Average is derived from them. Three
 * tiers, cheapest first:
 *
 *   - a student field: a real database order with skip/take, so only the page is touched.
 *   - an assignment column: one grouped query scoped to that assignment, one row per
 *     student, sorted here and sliced.
 *   - 'totalGrade': the same, but it needs every student's assigned flags and grades to
 *     compute the average.
 *
 * The last two are O(students) work that stays on the server; the browser still receives
 * one page either way. Candidates are pre-ordered by surname so the JS sort (which is
 * stable) falls back to name order when two students tie.
 */
export async function getCourseGradePage(
  params: GradePageParams,
): Promise<{ rows: GradePageRow[]; total: number }> {
  const { courseId, skip, take, q, sortBy, sortDir } = params;
  const dir: 'asc' | 'desc' = sortDir === 'desc' ? 'desc' : 'asc';

  // Every student, dropped included: the gradebook keeps dropped students (labeled) so
  // their retained grades stay visible and editable.
  const where: Prisma.RosterWhereInput = {
    courseId,
    role: 'STUDENT',
    ...(q
      ? {
          user: {
            OR: [
              { firstName: { contains: q, mode: 'insensitive' } },
              { lastName: { contains: q, mode: 'insensitive' } },
              { email: { contains: q, mode: 'insensitive' } },
            ],
          },
        }
      : {}),
  };

  const assignmentRows = await loadAssignmentRows(courseId);
  const assignments = toColumns(assignmentRows);
  const assignmentIds = assignments.map((a) => a.id);
  const isAssignmentSort = !!sortBy && assignmentIds.includes(sortBy);
  const isDerivedSort = sortBy === 'totalGrade' || isAssignmentSort;

  const total = await prisma.roster.count({ where });

  const nameOrder: Prisma.RosterOrderByWithRelationInput[] = [
    { user: { lastName: dir } },
    { user: { firstName: dir } },
    { userId: 'asc' },
  ];

  let pageIds: string[];
  let statusById: Map<string, string>;
  // Reused when a derived sort has already computed them for every candidate.
  let assignedAll: Record<string, Record<string, boolean>> | null = null;
  let gradesAll: Record<string, Record<string, number | null>> | null = null;

  if (!isDerivedSort) {
    const STUDENT_ORDER: Record<string, Prisma.RosterOrderByWithRelationInput[]> = {
      lastName: nameOrder,
      firstName: [{ user: { firstName: dir } }, { user: { lastName: dir } }, { userId: 'asc' }],
      email: [{ user: { email: dir } }, { userId: 'asc' }],
    };
    const rows = await prisma.roster.findMany({
      where,
      orderBy: STUDENT_ORDER[sortBy ?? ''] ?? nameOrder,
      skip,
      take,
      select: { userId: true, status: true },
    });
    pageIds = rows.map((r) => r.userId);
    statusById = new Map(rows.map((r) => [r.userId, r.status]));
  } else {
    // Surname order first, so the stable sort below tie-breaks by name.
    const candidates = await prisma.roster.findMany({
      where,
      orderBy: [{ user: { lastName: 'asc' } }, { user: { firstName: 'asc' } }, { userId: 'asc' }],
      select: { userId: true, status: true },
    });
    const candidateIds = candidates.map((c) => c.userId);
    statusById = new Map(candidates.map((c) => [c.userId, c.status]));

    let keyOf: (id: string) => number | undefined;
    if (isAssignmentSort) {
      // Only the one column's totals are needed, so this stays one row per student.
      const sums = await loadGradeSums([sortBy as string], candidateIds);
      keyOf = (id) => sums[id]?.[sortBy as string] ?? undefined;
    } else {
      assignedAll = await buildAssignedMap(assignmentRows, candidateIds);
      gradesAll = await loadGradeSums(assignmentIds, candidateIds);
      keyOf = (id) => averagePct(assignments, assignedAll?.[id], gradesAll?.[id]);
    }

    const ordered = [...candidateIds].sort((a, b) => {
      const ka = keyOf(a);
      const kb = keyOf(b);
      // Students with nothing to compare sort last whichever way the column points,
      // matching the table's `sortUndefined: 'last'`.
      if (ka === undefined && kb === undefined) return 0;
      if (ka === undefined) return 1;
      if (kb === undefined) return -1;
      return dir === 'asc' ? ka - kb : kb - ka;
    });
    pageIds = ordered.slice(skip, skip + take);
  }

  if (pageIds.length === 0) return { rows: [], total };

  const users = await prisma.user.findMany({
    where: { id: { in: pageIds } },
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
  });
  const userMap = new Map(users.map((u) => [u.id, u]));

  const assigned = assignedAll ?? (await buildAssignedMap(assignmentRows, pageIds));
  const grades = gradesAll ?? (await loadGradeSums(assignmentIds, pageIds));

  const rows: GradePageRow[] = pageIds
    .map((id) => userMap.get(id))
    .filter((u): u is NonNullable<typeof u> => !!u)
    .map((u) => ({
      id: u.id,
      firstName: u.firstName,
      lastName: u.lastName,
      email: u.email,
      avatar: u.avatar,
      cropX: u.cropX,
      cropY: u.cropY,
      zoom: u.zoom,
      enrollmentStatus: statusById.get(u.id) ?? 'ENROLLED',
      assigned: assigned[u.id] ?? {},
      grades: grades[u.id] ?? {},
    }));

  return { rows, total };
}
