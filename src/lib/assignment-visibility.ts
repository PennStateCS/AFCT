import type { Prisma } from '@prisma/client';

/**
 * A student is "assigned" an assignment when it is assigned to everyone, or when they
 * have a per-student override row. This is the single definition both the DB queries
 * (via `assignedToStudentWhere`) and the in-memory checks (`isStudentAssigned`) use, so
 * "assign to specific students" is enforced consistently across every student surface.
 */
export function assignedToStudentWhere(userId: string): Prisma.AssignmentWhereInput {
  return { OR: [{ assignedToEveryone: true }, { overrides: { some: { userId } } }] };
}

export function isStudentAssigned(
  assignment: { assignedToEveryone: boolean },
  overrides: Array<{ userId: string | null }>,
  userId: string,
): boolean {
  return assignment.assignedToEveryone || overrides.some((o) => o.userId === userId);
}
