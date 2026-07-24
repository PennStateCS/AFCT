import { prisma } from '@/lib/prisma';
import { isStudentAssigned } from '@/lib/assignment-visibility';
import {
  buildAssignmentStatistics,
  type AssignmentStatistics,
  type StatsParticipant,
  type StatsProblem,
  type SubmissionQueueStatus,
} from '@/lib/assignment-statistics';

/**
 * Server-side aggregator for the assignment Statistics tab. It loads exactly what the
 * three charts need in a handful of batched queries (no per-participant reads, no N+1),
 * maps it into the database-agnostic shape `buildAssignmentStatistics` expects, and lets
 * that pure core decide every number. Presentation lives in the client components.
 *
 * Unit: an INDIVIDUAL assignment (no group set) is measured in students; a GROUP
 * assignment is measured in groups. The two are never mixed. Because an autograded group
 * submission fans its grade out identically to every member (see submission-worker), a
 * group's per-problem grade is read from its members' grade rows, and its per-problem
 * submission status from the group's own submissions.
 */
export type AssignmentStatisticsPayload = AssignmentStatistics & {
  assignmentTitle: string;
  /** The assignment's base (Everyone) due date, ISO. */
  baseDueDate: string;
  /** Course timezone, so the client formats the due date the same way the rest of the app does. */
  timezone: string;
};

/** Just the override fields needed to decide who has a due-date exception. */
type OverrideTarget = { targetType: 'STUDENT' | 'GROUP'; userId: string | null; groupId: string | null };

export async function getAssignmentStatistics(
  courseId: string,
  assignmentId: string,
): Promise<AssignmentStatisticsPayload | null> {
  const assignment = await prisma.assignment.findFirst({
    where: { id: assignmentId, courseId },
    select: {
      id: true,
      title: true,
      dueDate: true,
      assignedToEveryone: true,
      groupSetId: true,
      course: { select: { timezone: true } },
      assignees: { select: { userId: true, groupId: true } },
      problems: { select: { problemId: true, maxPoints: true, problem: { select: { title: true } } } },
    },
  });
  if (!assignment) return null;

  // Problem order: there is no persisted per-assignment order, so use title ascending,
  // matching the Problems tab's default sort. The box plots render in this order.
  const problems: StatsProblem[] = assignment.problems
    .map((ap) => ({
      id: ap.problemId,
      title: ap.problem.title,
      maxPoints: Number(ap.maxPoints ?? 0),
      order: 0,
    }))
    .sort((a, b) => a.title.localeCompare(b.title))
    .map((p, i) => ({ ...p, order: i }));

  // Override rows only decide who has a due-date exception (shown near the heading); the
  // status chart no longer depends on deadlines.
  const overrides: OverrideTarget[] = await prisma.assignmentOverride.findMany({
    where: { assignmentId },
    select: { targetType: true, userId: true, groupId: true },
  });

  // Per-(student, problem) recorded grade. A key existing means "graded"; a value of 0 is
  // a real zero. Used directly for individual participants and aggregated for groups.
  const gradeRows = await prisma.assignmentProblemGrade.findMany({
    where: { assignmentId },
    select: { studentId: true, problemId: true, grade: true },
  });
  const gradesByStudent = new Map<string, Record<string, number>>();
  for (const g of gradeRows) {
    const rec = gradesByStudent.get(g.studentId) ?? {};
    rec[g.problemId] = Number(g.grade);
    gradesByStudent.set(g.studentId, rec);
  }

  const isGroupAssignment = assignment.groupSetId != null;

  const participants = isGroupAssignment
    ? await buildGroupParticipants(assignment.groupSetId!, assignment, overrides, gradesByStudent)
    : await buildStudentParticipants(courseId, assignment, overrides, gradesByStudent);

  const stats = buildAssignmentStatistics({
    unit: isGroupAssignment ? 'group' : 'student',
    problems,
    participants,
  });

  return {
    ...stats,
    assignmentTitle: assignment.title,
    baseDueDate: assignment.dueDate.toISOString(),
    timezone: assignment.course?.timezone ?? 'UTC',
  };
}

type AssignmentShape = {
  id: string;
  assignedToEveryone: boolean;
  assignees: { userId: string | null; groupId: string | null }[];
};

// ─── individual (student) participants ───────────────────────────────────────

async function buildStudentParticipants(
  courseId: string,
  assignment: AssignmentShape,
  overrides: OverrideTarget[],
  gradesByStudent: Map<string, Record<string, number>>,
): Promise<StatsParticipant[]> {
  const roster = await prisma.roster.findMany({
    where: { courseId, role: 'STUDENT' },
    select: { userId: true },
  });
  const studentIds = roster.map((r) => r.userId);
  if (studentIds.length === 0) return [];

  // Group memberships only matter here if the assignment targets specific groups; load
  // them for the assigned decision (individual assignments usually target students only).
  const memberships =
    assignment.assignedToEveryone || assignment.assignees.some((a) => a.groupId)
      ? await prisma.groupMembership.findMany({
          where: { userId: { in: studentIds } },
          select: { userId: true, groupId: true },
        })
      : [];
  const groupIdsByStudent = new Map<string, string[]>();
  for (const m of memberships) {
    const list = groupIdsByStudent.get(m.userId) ?? [];
    list.push(m.groupId);
    groupIdsByStudent.set(m.userId, list);
  }

  const assignedStudentIds = studentIds.filter((id) =>
    isStudentAssigned(
      { assignedToEveryone: assignment.assignedToEveryone },
      assignment.assignees,
      id,
      groupIdsByStudent.get(id) ?? [],
    ),
  );
  if (assignedStudentIds.length === 0) return [];

  // The queue state of each (student, problem)'s LATEST submission: distinct on the pair,
  // newest first, so the first row per pair is the current one (same pattern as
  // student-assignments.ts). No submission for a pair -> that problem is "missing".
  const latestRows = await prisma.submission.findMany({
    where: { assignmentId: assignment.id, studentGroupId: null },
    distinct: ['studentId', 'problemId'],
    orderBy: { submittedAt: 'desc' },
    select: { studentId: true, problemId: true, status: true },
  });
  const statusByStudent = new Map<string, Record<string, SubmissionQueueStatus>>();
  for (const row of latestRows) {
    const rec = statusByStudent.get(row.studentId) ?? {};
    rec[row.problemId] = row.status as SubmissionQueueStatus;
    statusByStudent.set(row.studentId, rec);
  }

  const studentHasException = new Set(
    overrides.filter((o) => o.targetType === 'STUDENT' && o.userId).map((o) => o.userId!),
  );

  return assignedStudentIds.map((studentId) => ({
    id: studentId,
    hasException: studentHasException.has(studentId),
    problemGrades: gradesByStudent.get(studentId) ?? {},
    latestStatusByProblem: statusByStudent.get(studentId) ?? {},
  }));
}

// ─── group participants ──────────────────────────────────────────────────────

async function buildGroupParticipants(
  groupSetId: string,
  assignment: AssignmentShape,
  overrides: OverrideTarget[],
  gradesByStudent: Map<string, Record<string, number>>,
): Promise<StatsParticipant[]> {
  const groups = await prisma.studentGroup.findMany({
    where: { groupSetId },
    select: { id: true, memberships: { select: { userId: true } } },
  });

  const namedGroupIds = new Set(
    assignment.assignees.map((a) => a.groupId).filter((g): g is string => !!g),
  );
  // Assigned groups: everyone -> all groups in the set, else the groups named as assignees.
  // A memberless group can't participate, so it's not counted (avoids inflating "missing").
  const assignedGroups = groups.filter(
    (g) => (assignment.assignedToEveryone || namedGroupIds.has(g.id)) && g.memberships.length > 0,
  );
  if (assignedGroups.length === 0) return [];

  const latestRows = await prisma.submission.findMany({
    where: { assignmentId: assignment.id, studentGroupId: { not: null } },
    distinct: ['studentGroupId', 'problemId'],
    orderBy: { submittedAt: 'desc' },
    select: { studentGroupId: true, problemId: true, status: true },
  });
  const statusByGroup = new Map<string, Record<string, SubmissionQueueStatus>>();
  for (const row of latestRows) {
    if (!row.studentGroupId) continue;
    const rec = statusByGroup.get(row.studentGroupId) ?? {};
    rec[row.problemId] = row.status as SubmissionQueueStatus;
    statusByGroup.set(row.studentGroupId, rec);
  }

  const groupHasException = new Set(
    overrides.filter((o) => o.targetType === 'GROUP' && o.groupId).map((o) => o.groupId!),
  );

  return assignedGroups.map((group) => {
    // Aggregate members' grade rows: a problem is graded for the group when any member has
    // a grade row (autograde writes identical rows to every member); take the max so a lone
    // manually-graded member is still reflected.
    const groupGrades: Record<string, number> = {};
    for (const member of group.memberships) {
      const rec = gradesByStudent.get(member.userId);
      if (!rec) continue;
      for (const [problemId, grade] of Object.entries(rec)) {
        const existing = groupGrades[problemId];
        groupGrades[problemId] = existing === undefined ? grade : Math.max(existing, grade);
      }
    }

    return {
      id: group.id,
      hasException: groupHasException.has(group.id),
      problemGrades: groupGrades,
      latestStatusByProblem: statusByGroup.get(group.id) ?? {},
    };
  });
}
