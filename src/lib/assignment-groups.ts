import { prisma } from '@/lib/prisma';

/**
 * The StudentGroup ids that (a) the student is a member of and (b) are GROUP-targeted on
 * this assignment. Because a group assignment is tied to one group set and a student
 * belongs to at most one group per set, this resolves to at most one id. Empty when the
 * student is not group-assigned (they may still be assigned individually or via everyone).
 *
 * This is the bridge between the group-set membership tables and the assignment override
 * rows: the deadline resolver and the submission/read paths use it to decide the student's
 * effective window and their group submission set.
 */
export async function resolveStudentAssignmentGroupIds(
  assignmentId: string,
  userId: string,
): Promise<string[]> {
  const rows = await prisma.assignmentOverride.findMany({
    where: {
      assignmentId,
      targetType: 'GROUP',
      studentGroup: { memberships: { some: { userId } } },
    },
    select: { groupId: true },
  });
  return rows.map((r) => r.groupId).filter((g): g is string => g != null);
}

/**
 * The single group submission a student's submit should write to for an assignment, or
 * null for an individual submission. Given the one-target-per-student rule this is the
 * first (only) targeted group the student belongs to.
 */
export async function resolveStudentSubmissionGroupId(
  assignmentId: string,
  userId: string,
): Promise<string | null> {
  const ids = await resolveStudentAssignmentGroupIds(assignmentId, userId);
  return ids[0] ?? null;
}
