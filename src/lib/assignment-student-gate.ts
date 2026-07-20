import { prisma } from '@/lib/prisma';
import { assignedToStudentWhere, overridesForStudentWhere } from '@/lib/assignment-visibility';
import { effectiveDeadline } from '@/lib/effective-deadline';

export type StudentContentGate = {
  /** The assignment is assigned to this student (everyone / individual row / their group). */
  assigned: boolean;
  /** Their effective unlock time has not passed yet, so its content must stay hidden. */
  locked: boolean;
  /** The resolved unlock instant (their override, their group's, or the base), if any. */
  unlockAt: Date | null;
};

/**
 * Whether a student may see one assignment's content right now. Two independent gates:
 *
 *  - assigned: the assignment is assigned to them (see `assignedToStudentWhere`). A student
 *    who is not assigned must not learn the assignment exists at all.
 *  - locked: their effective unlock time (their own override, else their group's, else the
 *    assignment's base `unlockAt`) is still in the future, so descriptions, problem titles
 *    and constraints stay hidden until it opens.
 *
 * Callers are expected to apply this only to non-staff; course staff bypass both gates.
 * The routes that serve assignment/problem content to a student all funnel through this so
 * the rule lives in one place.
 */
export async function resolveStudentContentGate(
  assignmentId: string,
  studentId: string,
  now: Date = new Date(),
): Promise<StudentContentGate> {
  const assignment = await prisma.assignment.findFirst({
    where: { id: assignmentId, ...assignedToStudentWhere(studentId) },
    select: {
      unlockAt: true,
      dueDate: true,
      allowLateSubmissions: true,
      lateCutoff: true,
    },
  });

  // Not assigned: nothing is visible, and the caller should mask this as a 404.
  if (!assignment) return { assigned: false, locked: true, unlockAt: null };

  const overrides = await prisma.assignmentOverride.findMany({
    where: { assignmentId, ...overridesForStudentWhere(studentId) },
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

  // Every row is already scoped to this student, so any group id present is one of theirs.
  const studentGroupIds = overrides
    .map((o) => o.groupId)
    .filter((id): id is string => id !== null);

  const eff = effectiveDeadline(assignment, overrides, studentId, studentGroupIds);
  const locked = !!eff.unlockAt && eff.unlockAt.getTime() > now.getTime();

  return { assigned: true, locked, unlockAt: eff.unlockAt };
}
