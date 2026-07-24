import { prisma } from '@/lib/prisma';
import { isStudentAssigned } from '@/lib/assignment-visibility';
import {
  buildAssignmentStatistics,
  type AssignmentStatistics,
  type StatsParticipant,
  type StatsProblem,
  type StatsSubmission,
  type SubmissionQueueStatus,
} from '@/lib/assignment-statistics';

/**
 * Server-side aggregator for the assignment Statistics tab. It loads exactly what the
 * charts need in a handful of batched queries (no per-participant reads, no N+1), maps it
 * into the database-agnostic shape `buildAssignmentStatistics` expects, and lets that pure
 * core decide every number. Presentation lives in the client components.
 *
 * Unit: an INDIVIDUAL assignment (no group set) is measured in students; a GROUP
 * assignment is measured in groups. The two are never mixed. Because an autograded group
 * submission fans its grade out identically to every member (see submission-worker), a
 * group's per-problem grade is read from its members' grade rows, and its submissions are
 * the group's own (studentGroupId) submissions.
 */
export type AssignmentStatisticsPayload = AssignmentStatistics & {
  assignmentTitle: string;
  /** The assignment's base (Everyone) due date, ISO. */
  baseDueDate: string;
  /** Course timezone, so the client formats the due date the same way the rest of the app does. */
  timezone: string;
};

type OverrideTarget = { targetType: 'STUDENT' | 'GROUP'; userId: string | null; groupId: string | null };

/** Latest queue status per problem, keyed by participant id. */
type LatestStatusMap = Map<string, Record<string, SubmissionQueueStatus>>;

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

  const timeZone = assignment.course?.timezone ?? 'UTC';
  const isGroupAssignment = assignment.groupSetId != null;

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

  // Override rows only decide who has a due-date exception (shown near the heading).
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

  // Every submission for the relevant scope, oldest first. One read serves three purposes:
  // the latest queue status per participant/problem (last row wins), and the attempt /
  // timeline / heatmap aggregations in the pure core.
  const submissionRows = await prisma.submission.findMany({
    where: {
      assignmentId,
      studentGroupId: isGroupAssignment ? { not: null } : null,
    },
    orderBy: { submittedAt: 'asc' },
    select: {
      studentId: true,
      studentGroupId: true,
      problemId: true,
      submittedAt: true,
      correct: true,
      status: true,
    },
  });
  const keyOf = (r: { studentId: string; studentGroupId: string | null }) =>
    isGroupAssignment ? r.studentGroupId! : r.studentId;

  const latestStatus: LatestStatusMap = new Map();
  for (const r of submissionRows) {
    const k = keyOf(r);
    const rec = latestStatus.get(k) ?? {};
    rec[r.problemId] = r.status as SubmissionQueueStatus; // asc order -> the last write is newest
    latestStatus.set(k, rec);
  }

  const participants = isGroupAssignment
    ? await buildGroupParticipants(assignment.groupSetId!, assignment, overrides, gradesByStudent, latestStatus)
    : await buildStudentParticipants(courseId, assignment, overrides, gradesByStudent, latestStatus);

  // Only count submissions from participants who are actually assigned this assignment.
  const assignedIds = new Set(participants.map((p) => p.id));
  const submissions: StatsSubmission[] = submissionRows
    .filter((r) => assignedIds.has(keyOf(r)))
    .map((r) => ({
      participantId: keyOf(r),
      problemId: r.problemId,
      submittedAt: r.submittedAt.getTime(),
      correct: r.correct === true,
    }));

  const stats = buildAssignmentStatistics({
    unit: isGroupAssignment ? 'group' : 'student',
    problems,
    participants,
    submissions,
    timeZone,
  });

  return {
    ...stats,
    assignmentTitle: assignment.title,
    baseDueDate: assignment.dueDate.toISOString(),
    timezone: timeZone,
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
  latestStatus: LatestStatusMap,
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

  const studentHasException = new Set(
    overrides.filter((o) => o.targetType === 'STUDENT' && o.userId).map((o) => o.userId!),
  );

  return assignedStudentIds.map((studentId) => ({
    id: studentId,
    hasException: studentHasException.has(studentId),
    problemGrades: gradesByStudent.get(studentId) ?? {},
    latestStatusByProblem: latestStatus.get(studentId) ?? {},
  }));
}

// ─── group participants ──────────────────────────────────────────────────────

async function buildGroupParticipants(
  groupSetId: string,
  assignment: AssignmentShape,
  overrides: OverrideTarget[],
  gradesByStudent: Map<string, Record<string, number>>,
  latestStatus: LatestStatusMap,
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
      latestStatusByProblem: latestStatus.get(group.id) ?? {},
    };
  });
}
