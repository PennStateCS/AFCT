// src/lib/student-assignments.ts
import { prisma } from '@/lib/prisma';
import type { ProblemType } from '@prisma/client';

export type StudentAssignmentProblem = {
  id: string;
  title: string | null;
  type: ProblemType | null;
  autograderEnabled: boolean;
  maxPoints: number;
  maxSubmissions: number;
  grade: number | null;
  submissionCount: number;
  /** Status of the student's most recent submission for this problem ('' if none). */
  status: string;
};

export type StudentAssignment = {
  id: string;
  title: string;
  description: string | null;
  dueDate: Date | null;
  allowLateSubmissions: boolean;
  lateCutoff: Date | null;
  problems: StudentAssignmentProblem[];
};

/**
 * A student's view of a course's **published** assignments: each assignment with
 * its problems (per-assignment maxPoints/maxSubmissions/type) plus this student's own
 * grade, latest submission status, and attempt count. Never includes the answer-key
 * `fileName`. The caller MUST have already gated course access (e.g. via
 * `withCourseAuth({ access: 'read' })` or `canAccessCourse`).
 *
 * Shared by the web student-grades route and the native-client assignments endpoint.
 */
export async function getStudentCourseAssignments(
  userId: string,
  courseId: string,
): Promise<StudentAssignment[]> {
  const assignments = await prisma.assignment.findMany({
    where: { courseId, isPublished: true },
    select: {
      id: true,
      title: true,
      description: true,
      dueDate: true,
      allowLateSubmissions: true,
      lateCutoff: true,
    },
    orderBy: { dueDate: 'asc' },
  });

  const assignmentIds = assignments.map((a) => a.id);
  if (assignmentIds.length === 0) return [];

  // All four reads depend only on `assignmentIds`, so run them concurrently.
  const [problems, grades, submissionCounts, latestSubmissions] = await Promise.all([
    prisma.assignmentProblem.findMany({
      where: { assignmentId: { in: assignmentIds } },
      select: {
        assignmentId: true,
        maxPoints: true,
        maxSubmissions: true,
        problem: { select: { id: true, title: true, type: true, autograderEnabled: true } },
      },
      orderBy: { assignmentId: 'asc' },
    }),
    prisma.assignmentProblemGrade.findMany({
      where: { assignmentId: { in: assignmentIds }, studentId: userId },
      select: { assignmentId: true, problemId: true, grade: true },
    }),
    prisma.submission.groupBy({
      by: ['assignmentId', 'problemId'],
      where: { assignmentId: { in: assignmentIds }, studentId: userId },
      _count: { id: true },
    }),
    prisma.submission.findMany({
      where: { assignmentId: { in: assignmentIds }, studentId: userId },
      distinct: ['assignmentId', 'problemId'],
      orderBy: { createdAt: 'desc' },
      select: { assignmentId: true, problemId: true, status: true },
    }),
  ]);

  const gradeMap = new Map<string, number | null>();
  grades.forEach((g) => gradeMap.set(`${g.assignmentId}:${g.problemId}`, g.grade ?? null));
  const countMap = new Map<string, number>();
  submissionCounts.forEach((c) => countMap.set(`${c.assignmentId}:${c.problemId}`, c._count.id));
  const statusMap = new Map<string, string>();
  latestSubmissions.forEach((s) => statusMap.set(`${s.assignmentId}:${s.problemId}`, s.status));

  const byAssignment: Record<string, StudentAssignmentProblem[]> = {};
  for (const p of problems) {
    const key = `${p.assignmentId}:${p.problem.id}`;
    (byAssignment[p.assignmentId] ??= []).push({
      id: p.problem.id,
      title: p.problem.title,
      type: p.problem.type,
      autograderEnabled: p.problem.autograderEnabled,
      maxPoints: Number(p.maxPoints ?? 0),
      maxSubmissions: Number(p.maxSubmissions ?? 0),
      grade: gradeMap.get(key) ?? null,
      submissionCount: countMap.get(key) ?? 0,
      status: statusMap.get(key) ?? '',
    });
  }

  return assignments.map((a) => ({
    id: a.id,
    title: a.title,
    description: a.description,
    dueDate: a.dueDate ?? null,
    allowLateSubmissions: a.allowLateSubmissions,
    lateCutoff: a.lateCutoff ?? null,
    problems: byAssignment[a.id] ?? [],
  }));
}
