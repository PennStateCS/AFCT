import { prisma } from '@/lib/prisma';
import type { CalendarAssignment } from '@/lib/calendar-shared';
export { getDateKeyInTimeZone, getMonthRangeIso } from '@/lib/calendar-shared';

export async function resolveUserTimezone(userId?: string | null) {
  const tz = 'America/New_York';
  if (!userId) return tz;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { timezone: true },
  });
  if (user?.timezone) return user.timezone;

  const system = await prisma.systemSettings.findUnique({ where: { id: 1 } });
  return system?.timezone || tz;
}

export async function getAssignmentsForUserRange(params: {
  userId: string;
  role: string;
  startDate: Date;
  endDate: Date;
}): Promise<CalendarAssignment[]> {
  const { userId, role, startDate, endDate } = params;

  const rosterEntries = await prisma.roster.findMany({
    where: { userId },
    select: { courseId: true },
  });
  const courseIds = rosterEntries.map((r) => r.courseId);
  if (courseIds.length === 0) return [];

  const assignments = await prisma.assignment.findMany({
    where: {
      courseId: { in: courseIds },
      dueDate: {
        gte: startDate,
        lte: endDate,
      },
    },
    select: {
      id: true,
      title: true,
      courseId: true,
      dueDate: true,
      course: {
        select: { id: true, code: true, name: true },
      },
    },
    orderBy: { dueDate: 'asc' },
  });

  const assignmentIds = assignments.map((a) => a.id);
  if (assignmentIds.length === 0) return [];

  if (role === 'STUDENT') {
    const studentSubmissions = await prisma.submission.findMany({
      where: { studentId: userId, assignmentId: { in: assignmentIds } },
      select: { assignmentId: true },
    });
    const submissionSet = new Set(studentSubmissions.map((s) => s.assignmentId));

    const studentGrades = await prisma.assignmentGrade.findMany({
      where: { studentId: userId, assignmentId: { in: assignmentIds } },
      select: { assignmentId: true },
    });
    const gradeSet = new Set(studentGrades.map((g) => g.assignmentId));

    return assignments.map((a) => ({
      ...a,
      crossedOut: submissionSet.has(a.id) || gradeSet.has(a.id),
      studentHasSubmission: submissionSet.has(a.id),
      studentHasGrade: gradeSet.has(a.id),
    }));
  }

  const courseIdsSet = Array.from(new Set(assignments.map((a) => a.courseId)));

  const studentCounts = await prisma.roster.groupBy({
    by: ['courseId'],
    where: { courseId: { in: courseIdsSet }, role: 'STUDENT' },
    _count: { _all: true },
  });
  const studentCountByCourse: Record<string, number> = {};
  studentCounts.forEach((c) => {
    studentCountByCourse[c.courseId] = c._count._all;
  });

  const gradedCounts = await prisma.assignmentGrade.groupBy({
    by: ['assignmentId'],
    where: { assignmentId: { in: assignmentIds } },
    _count: { _all: true },
  });
  const gradedCountByAssignment: Record<string, number> = {};
  gradedCounts.forEach((g) => {
    gradedCountByAssignment[g.assignmentId] = g._count._all;
  });

  const now = new Date();
  return assignments.map((a) => {
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
  });
}
