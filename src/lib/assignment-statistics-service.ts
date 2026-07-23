import { prisma } from '@/lib/prisma';
import { effectiveDeadline, type OverrideRow } from '@/lib/effective-deadline';
import { isStudentAssigned } from '@/lib/assignment-visibility';
import {
  buildAssignmentStatistics,
  type AssignmentStatistics,
  type StatsParticipant,
  type StatsProblem,
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
 * group's per-problem grade is read from its members' grade rows.
 */
export type AssignmentStatisticsPayload = AssignmentStatistics & {
  assignmentTitle: string;
  /** The assignment's base (Everyone) due date, ISO. */
  baseDueDate: string;
  /** Course timezone, so the client formats the due date the same way the rest of the app does. */
  timezone: string;
};

export async function getAssignmentStatistics(
  courseId: string,
  assignmentId: string,
  now: Date = new Date(),
): Promise<AssignmentStatisticsPayload | null> {
  const assignment = await prisma.assignment.findFirst({
    where: { id: assignmentId, courseId },
    select: {
      id: true,
      title: true,
      dueDate: true,
      unlockAt: true,
      allowLateSubmissions: true,
      lateCutoff: true,
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

  const base = {
    unlockAt: assignment.unlockAt,
    dueDate: assignment.dueDate,
    allowLateSubmissions: assignment.allowLateSubmissions,
    lateCutoff: assignment.lateCutoff,
  };

  // All override rows for the assignment (student + group), resolved per participant below.
  const overrideRows = await prisma.assignmentOverride.findMany({
    where: { assignmentId },
    select: {
      targetType: true,
      userId: true,
      groupId: true,
      unlockAt: true,
      dueDate: true,
      lateCutoff: true,
      allowLateSubmissions: true,
    },
  });
  const overrides: OverrideRow[] = overrideRows.map((o) => ({
    targetType: o.targetType,
    userId: o.userId,
    groupId: o.groupId,
    unlockAt: o.unlockAt,
    dueDate: o.dueDate,
    lateCutoff: o.lateCutoff,
    allowLateSubmissions: o.allowLateSubmissions,
  }));

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
    ? await buildGroupParticipants(assignment.groupSetId!, assignment, base, overrides, gradesByStudent)
    : await buildStudentParticipants(courseId, assignment, base, overrides, gradesByStudent);

  const stats = buildAssignmentStatistics({
    unit: isGroupAssignment ? 'group' : 'student',
    problems,
    participants,
    now,
  });

  return {
    ...stats,
    assignmentTitle: assignment.title,
    baseDueDate: assignment.dueDate.toISOString(),
    timezone: assignment.course?.timezone ?? 'UTC',
  };
}

type BaseDeadline = {
  unlockAt: Date | null;
  dueDate: Date;
  allowLateSubmissions: boolean;
  lateCutoff: Date | null;
};

type AssignmentShape = {
  id: string;
  assignedToEveryone: boolean;
  assignees: { userId: string | null; groupId: string | null }[];
};

// ─── individual (student) participants ───────────────────────────────────────

async function buildStudentParticipants(
  courseId: string,
  assignment: AssignmentShape,
  base: BaseDeadline,
  overrides: OverrideRow[],
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

  // Completion + activity, per student, without loading every attempt: the latest correct
  // submission per problem, and the set of students with any submission at all.
  // Per (student, problem): latest correct-submission time, and whether any submission
  // exists. Both grouped by problem so the charts can classify each problem independently.
  const [completedRows, anySubRows] = await Promise.all([
    prisma.submission.groupBy({
      by: ['studentId', 'problemId'],
      where: { assignmentId: assignment.id, correct: true, studentGroupId: null },
      _max: { submittedAt: true },
    }),
    prisma.submission.groupBy({
      by: ['studentId', 'problemId'],
      where: { assignmentId: assignment.id, studentGroupId: null },
    }),
  ]);

  const correctAt = new Map<string, Record<string, Date>>();
  for (const row of completedRows) {
    if (!row._max.submittedAt) continue;
    const rec = correctAt.get(row.studentId) ?? {};
    rec[row.problemId] = row._max.submittedAt;
    correctAt.set(row.studentId, rec);
  }
  const submitted = new Map<string, string[]>();
  for (const row of anySubRows) {
    const list = submitted.get(row.studentId) ?? [];
    list.push(row.problemId);
    submitted.set(row.studentId, list);
  }

  return assignedStudentIds.map((studentId) => {
    const eff = effectiveDeadline(base, overrides, studentId, []);
    return {
      id: studentId,
      effectiveDue: eff.dueDate,
      hasException: eff.source !== 'base',
      problemGrades: gradesByStudent.get(studentId) ?? {},
      correctAtByProblem: correctAt.get(studentId) ?? {},
      submittedProblemIds: submitted.get(studentId) ?? [],
    };
  });
}

// ─── group participants ──────────────────────────────────────────────────────

async function buildGroupParticipants(
  groupSetId: string,
  assignment: AssignmentShape,
  base: BaseDeadline,
  overrides: OverrideRow[],
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
  // A memberless group can't participate, so it's not counted (avoids inflating "not started").
  const assignedGroups = groups.filter(
    (g) => (assignment.assignedToEveryone || namedGroupIds.has(g.id)) && g.memberships.length > 0,
  );
  if (assignedGroups.length === 0) return [];

  const [completedRows, anySubRows] = await Promise.all([
    prisma.submission.groupBy({
      by: ['studentGroupId', 'problemId'],
      where: { assignmentId: assignment.id, correct: true, studentGroupId: { not: null } },
      _max: { submittedAt: true },
    }),
    prisma.submission.groupBy({
      by: ['studentGroupId', 'problemId'],
      where: { assignmentId: assignment.id, studentGroupId: { not: null } },
    }),
  ]);

  const correctAt = new Map<string, Record<string, Date>>();
  for (const row of completedRows) {
    if (!row.studentGroupId || !row._max.submittedAt) continue;
    const rec = correctAt.get(row.studentGroupId) ?? {};
    rec[row.problemId] = row._max.submittedAt;
    correctAt.set(row.studentGroupId, rec);
  }
  const submitted = new Map<string, string[]>();
  for (const row of anySubRows) {
    if (!row.studentGroupId) continue;
    const list = submitted.get(row.studentGroupId) ?? [];
    list.push(row.problemId);
    submitted.set(row.studentGroupId, list);
  }

  return assignedGroups.map((group) => {
    // A group inherits its due date from a GROUP override on this group (or the base). The
    // sentinel student id can't match any STUDENT override, so only the group rule applies.
    const eff = effectiveDeadline(base, overrides, `__group__:${group.id}`, [group.id]);

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
      effectiveDue: eff.dueDate,
      hasException: eff.source === 'group-override',
      problemGrades: groupGrades,
      correctAtByProblem: correctAt.get(group.id) ?? {},
      submittedProblemIds: submitted.get(group.id) ?? [],
    };
  });
}
