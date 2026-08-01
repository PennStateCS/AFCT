import { prisma } from '@/lib/prisma';

/**
 * The StudentGroup ids a student works in for this assignment: their group in the
 * assignment's group set, if it has one. At most one, because `GroupMembership` is unique
 * on (groupSetId, userId). Empty for an individual assignment, or for a student who is in
 * the set's course but not in any of its groups.
 *
 * **Membership is what decides this, not the audience rows.** A group assignment means the
 * group works together: the members share one submission set, one submission count, and one
 * cap, so "the group gets 5 attempts" is 5 between them rather than 5 each. That has to hold
 * however the assignment was targeted, and the default targeting is `assignedToEveryone`,
 * which carries no assignee rows at all.
 *
 * This used to read GROUP `AssignmentOverride` rows instead, which are date-only and usually
 * absent, so it returned nothing for an ordinary group assignment. The members then submitted
 * as individuals: separate submission sets, and a private cap each. Every read path that
 * shows a student their group had already been written against membership, so the two
 * disagreed, and an extra-submission grant aimed at a group was displayed but never enforced.
 */
export async function resolveStudentAssignmentGroupIds(
  assignmentId: string,
  userId: string,
): Promise<string[]> {
  const assignment = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    select: { groupSetId: true },
  });
  if (!assignment?.groupSetId) return [];

  const rows = await prisma.groupMembership.findMany({
    where: { groupSetId: assignment.groupSetId, userId },
    select: { groupId: true },
  });
  return rows.map((r) => r.groupId);
}

/**
 * The single group submission set a student's submit should write to for an assignment, or
 * null for an individual submission. Given the one-group-per-set rule this is the first
 * (only) group the student belongs to in the assignment's set.
 */
export async function resolveStudentSubmissionGroupId(
  assignmentId: string,
  userId: string,
): Promise<string | null> {
  const ids = await resolveStudentAssignmentGroupIds(assignmentId, userId);
  return ids[0] ?? null;
}
