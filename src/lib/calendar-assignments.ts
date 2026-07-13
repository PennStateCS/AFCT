import { prisma } from '@/lib/prisma';
import type { CalendarAssignment } from '@/lib/calendar-shared';
export { getDateKeyInTimeZone, getMonthRangeIso } from '@/lib/calendar-shared';
// Re-exported so existing importers keep working; the implementation now lives in
// one place (`@/lib/user-timezone`).
export { resolveUserTimezone } from '@/lib/user-timezone';

export async function getAssignmentsForUserRange(params: {
  userId: string;
  startDate: Date;
  endDate: Date;
}): Promise<CalendarAssignment[]> {
  const { userId, startDate, endDate } = params;

  const [rosterEntries, viewer] = await Promise.all([
    prisma.roster.findMany({
      where: { userId },
      select: { courseId: true, role: true },
    }),
    prisma.user.findUnique({ where: { id: userId }, select: { isAdmin: true } }),
  ]);
  const courseIds = rosterEntries.map((r) => r.courseId);
  if (courseIds.length === 0) return [];

  // The viewer may be staff in one course and a student in another, so decide the
  // calendar treatment per course from their roster role rather than a global one.
  // Admins get the staff treatment everywhere — the global flag outranks a STUDENT
  // roster row, matching the dashboard and the permission model.
  const isAdmin = Boolean(viewer?.isAdmin);
  const staffCourseIds = new Set(
    isAdmin
      ? courseIds
      : rosterEntries
          .filter((r) => r.role === 'FACULTY' || r.role === 'TA')
          .map((r) => r.courseId),
  );
  const staffCourseIdsArr = courseIds.filter((id) => staffCourseIds.has(id));
  const studentCourseIdsArr = courseIds.filter((id) => !staffCourseIds.has(id));

  const assignments = await prisma.assignment.findMany({
    where: {
      dueDate: {
        gte: startDate,
        lte: endDate,
      },
      // The calendar never includes archived or soft-deleted courses — for anyone.
      course: { isArchived: false, deletedAt: null },
      // In courses where the viewer is staff, show every assignment; where they
      // are a student, show only published assignments from published courses — a
      // student enrolled in an unpublished course gets no access to it at all, and
      // an unpublished assignment must not surface (title/due date) before release.
      OR: [
        { courseId: { in: staffCourseIdsArr } },
        {
          courseId: { in: studentCourseIdsArr },
          isPublished: true,
          course: { isPublished: true },
        },
      ],
    },
    select: {
      id: true,
      title: true,
      courseId: true,
      dueDate: true,
      // Carried through so staff can see (and the UI can mark) unpublished/draft
      // assignments. Students only ever receive published ones (see the OR above).
      isPublished: true,
      course: {
        select: { id: true, code: true, name: true },
      },
    },
    orderBy: { dueDate: 'asc' },
  });

  const assignmentIds = assignments.map((a) => a.id);
  if (assignmentIds.length === 0) return [];

  // Student-view data (for courses where the viewer is a student): their own
  // submissions and grades.
  const studentSubmissions = await prisma.submission.findMany({
    where: { studentId: userId, assignmentId: { in: assignmentIds } },
    select: { assignmentId: true },
  });
  const submissionSet = new Set(studentSubmissions.map((s) => s.assignmentId));

  const studentGrades = await prisma.assignmentProblemGrade.findMany({
    where: { studentId: userId, assignmentId: { in: assignmentIds } },
    select: { assignmentId: true },
  });
  const gradeSet = new Set(studentGrades.map((g) => g.assignmentId));

  // Staff-view data (for courses where the viewer is faculty/TA): class-wide
  // graded progress.
  const staffCourseIdList = Array.from(
    new Set(assignments.map((a) => a.courseId).filter((id) => staffCourseIds.has(id))),
  );

  const studentCountByCourse: Record<string, number> = {};
  const gradedCountByAssignment: Record<string, number> = {};
  if (staffCourseIdList.length > 0) {
    const staffAssignmentIds = assignments
      .filter((a) => staffCourseIds.has(a.courseId))
      .map((a) => a.id);

    const studentCounts = await prisma.roster.groupBy({
      by: ['courseId'],
      where: { courseId: { in: staffCourseIdList }, role: 'STUDENT' },
      _count: { _all: true },
    });
    studentCounts.forEach((c) => {
      studentCountByCourse[c.courseId] = c._count._all;
    });

    const gradedCounts = await prisma.assignmentProblemGrade.groupBy({
      by: ['assignmentId'],
      where: { assignmentId: { in: staffAssignmentIds } },
      _count: { _all: true },
    });
    gradedCounts.forEach((g) => {
      gradedCountByAssignment[g.assignmentId] = g._count._all;
    });
  }

  const now = new Date();
  return assignments.map((a) => {
    if (staffCourseIds.has(a.courseId)) {
      const totalStudents = studentCountByCourse[a.courseId] ?? 0;
      const gradedCount = gradedCountByAssignment[a.id] ?? 0;
      const allGraded = totalStudents > 0 && gradedCount >= totalStudents;
      const duePassed = new Date(a.dueDate) < now;
      return {
        ...a,
        crossedOut: duePassed && allGraded,
        totalStudents,
        gradedCount,
        allGraded,
      };
    }
    return {
      ...a,
      crossedOut: submissionSet.has(a.id) || gradeSet.has(a.id),
      studentHasSubmission: submissionSet.has(a.id),
      studentHasGrade: gradeSet.has(a.id),
    };
  });
}
