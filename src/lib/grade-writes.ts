import type { Prisma } from '@prisma/client';

/**
 * The one lock every path that writes a grade takes first.
 *
 * A grade is validated against the problem's `maxPoints`, and `maxPoints` can be changed. Each
 * did the obvious safe thing on its own and none of them agreed on an order: a grader read the
 * points, validated 10 against 10, and the settings route lowered them to 5 and committed
 * before the grade landed, leaving 10 out of 5 in the database. It reaches the LMS as a score
 * above its own maximum, which AGS does not accept.
 *
 * Holding the assignment-problem row is what orders them. It is the row both sides are really
 * arguing about, and taking it first means one of them waits: either the points move and the
 * grader revalidates against the new ceiling, or the grade lands and the settings route sees it
 * and refuses to go below it.
 *
 * Returns the current points so the caller validates against what it just locked rather than
 * what it read earlier. Reading them separately would put the check-then-act straight back.
 *
 * `FOR NO KEY UPDATE` rather than `FOR UPDATE`, and the difference is not cosmetic. Submissions
 * and grade rows both carry a foreign key to this row, so inserting one takes `FOR KEY SHARE` on
 * it, and `FOR UPDATE` is the one mode that blocks that. Holding it while a grade fans out to a
 * whole group stops every student in the course submitting to that problem until it commits, for
 * no reason: an insert that merely points at the row cannot change what it is worth. The weaker
 * mode still excludes everything this is actually defending against, another grader, an update
 * of the points, and a delete of the link, all of which take `FOR NO KEY UPDATE` or stronger.
 */
export async function lockProblemForGrading(
  tx: Prisma.TransactionClient,
  opts: { assignmentId: string; problemId: string },
): Promise<{ maxPoints: number } | null> {
  const rows = await tx.$queryRaw<{ maxPoints: number }[]>`
    SELECT "maxPoints" FROM "AssignmentProblem"
    WHERE "assignmentId" = ${opts.assignmentId} AND "problemId" = ${opts.problemId}
    FOR NO KEY UPDATE
  `;
  return rows[0] ?? null;
}

/**
 * Lock order, for anything that takes more than one of these.
 *
 * GroupSet, then AssignmentProblem, then the grade rows. Every path that touches two of them
 * does it in this order, so two of them cannot meet in the middle:
 *
 * - creating a submission: GroupSet (group work only), then AssignmentProblem
 * - grading a group: GroupSet, then AssignmentProblem, then the members' grade rows
 * - grading one student: AssignmentProblem, then their grade row
 * - changing a problem's points: AssignmentProblem
 * - editing group memberships, or deleting a group: GroupSet
 * - deleting an assignment or a problem: the rows that hang off it, never a GroupSet
 *
 * Adding a path that takes GroupSet *after* AssignmentProblem is what would break it.
 */
export const LOCK_ORDER = ['GroupSet', 'AssignmentProblem', 'AssignmentProblemGrade'] as const;
