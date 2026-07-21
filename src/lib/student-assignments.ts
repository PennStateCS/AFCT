// src/lib/student-assignments.ts
import { prisma } from '@/lib/prisma';
import type { ProblemType } from '@prisma/client';
import { effectiveDeadline } from '@/lib/effective-deadline';
import { assignedToStudentWhere } from '@/lib/assignment-visibility';

export type StudentAssignmentProblem = {
  id: string;
  title: string | null;
  description: string | null;
  type: ProblemType | null;
  /** FA/PDA state cap, or null when the problem sets no cap. */
  maxStates: number | null;
  /** FA determinism requirement, or null when it does not apply. */
  isDeterministic: boolean | null;
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
  /** The assignment's group set, or null for an individual assignment. */
  groupSetId: string | null;
  description: string | null;
  /** "Available from" resolved for this student; null means available immediately. */
  unlockAt: Date | null;
  dueDate: Date | null;
  allowLateSubmissions: boolean;
  lateCutoff: Date | null;
  /** True before unlockAt: the description and problems are withheld until it opens. */
  locked: boolean;
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
/**
 * Options widen the base student view for a privileged caller (course staff / admin
 * using the client): `includeUnpublished` drops the published-only filter, and
 * `includeUnassigned` drops the assigned-to-this-user filter, so staff see every
 * assignment in the course. Both default off, preserving the student view.
 */
export type CourseAssignmentsOptions = {
  includeUnpublished?: boolean;
  includeUnassigned?: boolean;
};

export async function getStudentCourseAssignments(
  userId: string,
  courseId: string,
  opts: CourseAssignmentsOptions = {},
): Promise<StudentAssignment[]> {
  const assignments = await prisma.assignment.findMany({
    // Published + assigned to this student, unless a privileged caller opts to widen.
    where: {
      courseId,
      ...(opts.includeUnpublished ? {} : { isPublished: true }),
      ...(opts.includeUnassigned ? {} : assignedToStudentWhere(userId)),
    },
    select: {
      id: true,
      title: true,
      groupSetId: true,
      description: true,
      unlockAt: true,
      dueDate: true,
      allowLateSubmissions: true,
      lateCutoff: true,
      // Only this student's override (0 or 1 row) so we can resolve their dates.
      overrides: {
        where: { userId },
        select: {
          targetType: true,
          userId: true,
          groupId: true,
          unlockAt: true,
          dueDate: true,
          lateCutoff: true,
          allowLateSubmissions: true,
        },
      },
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
        // Autograding is a per-assignment setting on the link, not on the bank problem.
        autograderEnabled: true,
        problem: {
          select: {
            id: true,
            title: true,
            description: true,
            type: true,
            maxStates: true,
            isDeterministic: true,
          },
        },
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
      description: p.problem.description,
      type: p.problem.type,
      maxStates: p.problem.maxStates,
      isDeterministic: p.problem.isDeterministic,
      autograderEnabled: p.autograderEnabled,
      maxPoints: Number(p.maxPoints ?? 0),
      maxSubmissions: Number(p.maxSubmissions ?? 0),
      grade: gradeMap.get(key) ?? null,
      submissionCount: countMap.get(key) ?? 0,
      status: statusMap.get(key) ?? '',
    });
  }

  const now = new Date();
  const resolved = assignments.map((a) => {
    const eff = effectiveDeadline(
      {
        unlockAt: a.unlockAt,
        dueDate: a.dueDate,
        allowLateSubmissions: a.allowLateSubmissions,
        lateCutoff: a.lateCutoff,
      },
      a.overrides ?? [],
      userId,
    );
    // Before an assignment unlocks, the student sees it exists and when it opens, but not
    // its description or problems (Canvas-style content lock).
    const locked = !!eff.unlockAt && eff.unlockAt.getTime() > now.getTime();
    return {
      id: a.id,
      title: a.title,
      groupSetId: a.groupSetId,
      description: locked ? null : a.description,
      unlockAt: eff.unlockAt,
      dueDate: eff.dueDate,
      allowLateSubmissions: eff.allowLateSubmissions,
      lateCutoff: eff.lateCutoff,
      locked,
      problems: locked ? [] : (byAssignment[a.id] ?? []),
    };
  });

  // The DB order is by the base due date; re-sort by each student's effective due so an
  // extension moves the assignment to its right place in this student's list. A null due
  // date sorts last, matching Postgres ASC ordering.
  const dueKey = (d: Date | null) => (d ? d.getTime() : Number.POSITIVE_INFINITY);
  resolved.sort((a, b) => dueKey(a.dueDate) - dueKey(b.dueDate));
  return resolved;
}
