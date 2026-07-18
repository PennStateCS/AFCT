import { prisma } from '@/lib/prisma';

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
};

export type GradeMatrixAssignment = {
  id: string;
  title: string;
  dueDate: Date | null;
  maxPoints: number;
};

export type CourseGradeMatrix = {
  students: GradeMatrixStudent[];
  assignments: GradeMatrixAssignment[];
  // grades[studentId][assignmentId] = summed points earned (problem grades collapsed), or null.
  grades: Record<string, Record<string, number | null>>;
};

/**
 * The full gradebook matrix for a course: enrolled students, assignments (with the
 * summed max points), and each student's summed grade per assignment. Shared by the
 * grades API (read) and the LMS export endpoint so both see identical numbers.
 */
export async function getCourseGradeMatrix(courseId: string): Promise<CourseGradeMatrix> {
  const roster = await prisma.roster.findMany({
    where: { courseId, role: 'STUDENT' },
    select: { userId: true },
    orderBy: { createdAt: 'asc' },
  });
  const rosterUserIds = roster.map((r) => r.userId);

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
    }));

  const assignmentRows = await prisma.assignment.findMany({
    where: { courseId },
    select: { id: true, title: true, dueDate: true, problems: { select: { maxPoints: true } } },
    orderBy: { dueDate: 'asc' },
  });
  const assignments: GradeMatrixAssignment[] = assignmentRows.map((a) => ({
    id: a.id,
    title: a.title,
    dueDate: a.dueDate,
    maxPoints: a.problems.reduce((sum, p) => sum + Number(p.maxPoints ?? 0), 0),
  }));

  const assignmentIds = assignments.map((a) => a.id);
  const studentIds = students.map((s) => s.id);

  const grades: Record<string, Record<string, number | null>> = {};
  for (const s of studentIds) {
    grades[s] = {};
    for (const a of assignmentIds) grades[s][a] = null;
  }

  if (assignmentIds.length === 0 || studentIds.length === 0) {
    return { students, assignments, grades };
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

  return { students, assignments, grades };
}
