import type { Prisma } from '@prisma/client';

/**
 * A student is "assigned" an assignment when it is assigned to everyone, when they have a
 * per-student override row, or when they are a member of a group that has a GROUP override
 * row. This is the single definition both the DB queries (via `assignedToStudentWhere`)
 * and the in-memory checks (`isStudentAssigned`) use, so "assign to specific students /
 * groups" is enforced consistently across every student surface.
 */
export function assignedToStudentWhere(userId: string): Prisma.AssignmentWhereInput {
  return {
    OR: [
      { assignedToEveryone: true },
      { overrides: { some: { userId } } },
      // Group target: the override points at a StudentGroup this student belongs to.
      { overrides: { some: { studentGroup: { memberships: { some: { userId } } } } } },
    ],
  };
}

export function isStudentAssigned(
  assignment: { assignedToEveryone: boolean },
  overrides: Array<{ userId: string | null; groupId?: string | null }>,
  userId: string,
  studentGroupIds: readonly string[] = [],
): boolean {
  // `!== false` so a missing flag (e.g. a partial select) defaults to assigned, matching
  // the NOT NULL default true on the column.
  if (assignment.assignedToEveryone !== false) return true;
  return overrides.some(
    (o) =>
      o.userId === userId || (o.groupId != null && studentGroupIds.includes(o.groupId)),
  );
}
