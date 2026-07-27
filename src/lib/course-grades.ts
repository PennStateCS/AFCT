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

  const assignmentRows = await prisma.assignment.findMany({
    where: { courseId },
    select: {
      id: true,
      title: true,
      dueDate: true,
      assignedToEveryone: true,
      problems: { select: { maxPoints: true } },
      // Individual (userId) and group (groupId) assignee rows, used to decide who is
      // actually assigned each assignment.
      assignees: { select: { userId: true, groupId: true } },
    },
    orderBy: { dueDate: 'asc' },
  });
  const assignments: GradeMatrixAssignment[] = assignmentRows.map((a) => ({
    id: a.id,
    title: a.title,
    dueDate: a.dueDate,
    maxPoints: a.problems.reduce((sum, p) => sum + Number(p.maxPoints ?? 0), 0),
  }));

  const studentIds = students.map((s) => s.id);

  const assigned: Record<string, Record<string, boolean>> = {};
  for (const s of studentIds) {
    assigned[s] = {};
    for (const a of assignments) assigned[s][a.id] = true;
  }

  if (assignments.length === 0 || studentIds.length === 0) {
    return { students, assignments, assigned };
  }

  // One batched membership read for the whole roster: each student's set of group ids,
  // used with the per-assignment group overrides to decide "assigned".
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

  // Compute "assigned" per (student, assignment) from the already-loaded assignees and
  // memberships (no per-cell queries): everyone, an individual assignee row, or a group
  // assignee row on a group the student belongs to.
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
 * The full gradebook matrix (structure + values) for a course. Shared by the LMS export
 * endpoint, which needs everything at once; the grades API serves the two halves
 * separately so the table can render progressively.
 */
export async function getCourseGradeMatrix(courseId: string): Promise<CourseGradeMatrix> {
  const [structure, values] = await Promise.all([
    getCourseGradeStructure(courseId),
    getCourseGradeValues(courseId),
  ]);
  return { ...structure, ...values };
}
