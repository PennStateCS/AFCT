import type { Prisma } from '@prisma/client';

/**
 * A student is "assigned" an assignment when it is assigned to everyone, when an
 * AssignmentAssignee row names them individually, or when a GROUP assignee row names a
 * group they belong to. This is the single definition both the DB queries (via
 * `assignedToStudentWhere`) and the in-memory checks (`isStudentAssigned`) use, so "assign
 * to specific students / groups" is enforced consistently across every student surface.
 *
 * Membership is the AssignmentAssignee table only. Date/late AssignmentOverride rows are a
 * separate concern (WHEN, not WHO) and never affect whether someone is assigned.
 */
export function assignedToStudentWhere(userId: string): Prisma.AssignmentWhereInput {
  return {
    OR: [
      { assignedToEveryone: true },
      { assignees: { some: { userId } } },
      // Group target: the assignee row points at a StudentGroup this student belongs to.
      { assignees: { some: { studentGroup: { memberships: { some: { userId } } } } } },
    ],
  };
}

export function isStudentAssigned(
  assignment: { assignedToEveryone: boolean },
  assignees: Array<{ userId: string | null; groupId?: string | null }>,
  userId: string,
  studentGroupIds: readonly string[] = [],
): boolean {
  // `!== false` so a missing flag (e.g. a partial select) defaults to assigned, matching
  // the NOT NULL default true on the column.
  if (assignment.assignedToEveryone !== false) return true;
  return assignees.some(
    (a) => a.userId === userId || (a.groupId != null && studentGroupIds.includes(a.groupId)),
  );
}
