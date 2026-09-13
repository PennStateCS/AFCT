import type { Prisma } from '@prisma/client';
import { effectiveDeadline } from '@/lib/effective-deadline';
import { evaluateSubmissionWindow } from '@/lib/submission-window';
import { isStudentAssigned } from '@/lib/assignment-visibility';
import { effectiveMaxSubmissions } from '@/lib/submission-limits';

/**
 * The rules that decide whether a submission may be accepted, in one place.
 *
 * `createSubmission` asks these twice. Once before it does any work, so a student who cannot
 * submit gets a useful answer without a transaction being opened; and again inside the
 * transaction that inserts, holding the rows the answers depend on, because that is the only
 * reading that counts.
 *
 * They were only ever asked the first way. Everything mutable, the course being archived, the
 * assignment being published, who it is assigned to, the deadline, the group somebody is in and
 * the cap they are under, was read and decided on before the transaction, which then re-checked
 * the count and the cooldown alone. An administrator archiving a course, an instructor moving a
 * student between groups or revoking an extra attempt, all committed in that gap and the
 * submission landed anyway, judged against a world that no longer existed.
 *
 * Pure and synchronous: the caller does the reads, through whichever client is correct for it,
 * and hands the rows in. That is what lets the same rules run against `prisma` and against a
 * transaction's own `tx` without two copies of them.
 */

/** What a read of the assignment has to provide for these rules to be applied to it. */
export type SubmissionAssignment = {
  courseId: string;
  unlockAt: Date | null;
  dueDate: Date;
  allowLateSubmissions: boolean;
  lateCutoff: Date | null;
  isPublished: boolean;
  assignedToEveryone: boolean;
  groupSetId: string | null;
  /** The submitter's group in this assignment's set, if any. At most one row. */
  groupSet: { groups: { id: string }[] } | null;
  /**
   * Optional only because a row can be read without them. The select always asks for both, and
   * treating an absent list as empty is the same reading the code here has always taken: it
   * fails closed, since a student with no assignee row is not assigned.
   */
  assignees?: {
    targetType: 'STUDENT' | 'GROUP';
    userId: string | null;
    groupId: string | null;
  }[];
  overrides?: {
    targetType: 'STUDENT' | 'GROUP';
    userId: string | null;
    groupId: string | null;
    unlockAt: Date | null;
    dueDate: Date | null;
    lateCutoff: Date | null;
    allowLateSubmissions: boolean | null;
  }[];
};

/** Which groups the submitter belongs to, and whose submission set they are writing into. */
export type SubmitterContext = {
  /** Their group in the assignment's set, or null. Membership decides this, not the audience. */
  membershipGroupId: string | null;
  /** Every group id that can match a GROUP assignee or override row for them. */
  studentGroupIds: string[];
  /** The group whose shared submission set this write belongs to, or null when individual. */
  submissionGroupId: string | null;
  /** Scope for the per-problem cap and cooldown: the whole group, or just this student. */
  countScope:
    | { assignmentId: string; problemId: string; studentGroupId: string }
    | { assignmentId: string; problemId: string; studentId: string };
};

/**
 * Work out the submitter's groups and the scope their attempts are counted in.
 *
 * Derived rather than stored, and derived the same way on both passes, because a membership
 * moved between them changes every one of these answers.
 */
export function resolveSubmitterContext(opts: {
  assignment: SubmissionAssignment;
  assignmentId: string;
  problemId: string;
  userId: string;
}): SubmitterContext {
  const { assignment, assignmentId, problemId, userId } = opts;

  // Membership decides it, not the audience rows, so an ordinary group assignment (the default,
  // `assignedToEveryone`, which carries no assignee rows) still behaves as a group.
  const membershipGroupId = assignment.groupSet?.groups[0]?.id ?? null;

  // The membership group first, then anything the audience or override rows name, so a group
  // targeted by an override the student is somehow no longer a member of still resolves dates.
  const studentGroupIds = [
    ...new Set(
      [
        membershipGroupId,
        ...(assignment.assignees ?? []).filter((a) => a.groupId != null).map((a) => a.groupId),
        ...(assignment.overrides ?? [])
          .filter((o) => o.targetType === 'GROUP' && o.groupId != null)
          .map((o) => o.groupId),
      ].filter((id): id is string => id != null),
    ),
  ];

  // A group assignment writes into the group's shared submission set: any member submits, all
  // members see it, and the cap and cooldown count group-wide. An individual assignment never
  // does, even if a stray GROUP override names a group the submitter is in.
  const submissionGroupId = assignment.groupSetId ? membershipGroupId : null;

  return {
    membershipGroupId,
    studentGroupIds,
    submissionGroupId,
    countScope: submissionGroupId
      ? { assignmentId, problemId, studentGroupId: submissionGroupId }
      : { assignmentId, problemId, studentId: userId },
  };
}

/** Why a submission may not be accepted. Null means it may. */
export type EligibilityRefusal =
  | { kind: 'archived' }
  | { kind: 'unpublished' }
  | { kind: 'not-assigned' }
  | { kind: 'not-open'; unlockAt: Date | null }
  | { kind: 'late-not-allowed' }
  | { kind: 'cutoff-passed' };

/**
 * Everything about the assignment and the course, judged for this submitter at this instant.
 *
 * Deliberately does NOT cover the cap or the cooldown. Those need a count, so they belong with
 * the reads that do the counting; these are the rules that can be answered from rows already in
 * hand, which is what lets the fast path answer them without a transaction.
 */
export function checkAssignmentEligibility(opts: {
  assignment: SubmissionAssignment;
  courseIsArchived: boolean;
  isCourseStaff: boolean;
  studentGroupIds: string[];
  userId: string;
  now: Date;
}): EligibilityRefusal | null {
  const { assignment, courseIsArchived, isCourseStaff, studentGroupIds, userId, now } = opts;

  // An archived course is frozen for everyone, staff and admins included.
  if (courseIsArchived) return { kind: 'archived' };

  // Students may only submit to a published assignment; staff may test unpublished ones.
  if (!assignment.isPublished && !isCourseStaff) return { kind: 'unpublished' };

  // "Assign to specific students": a student not assigned this work cannot submit to it.
  const assigned = isStudentAssigned(
    assignment,
    assignment.assignees ?? [],
    userId,
    studentGroupIds,
  );
  if (!assigned && !isCourseStaff) return { kind: 'not-assigned' };

  const deadline = effectiveDeadline(
    {
      unlockAt: assignment.unlockAt,
      dueDate: assignment.dueDate,
      allowLateSubmissions: assignment.allowLateSubmissions,
      lateCutoff: assignment.lateCutoff,
    },
    assignment.overrides ?? [],
    userId,
    studentGroupIds,
  );
  const window = evaluateSubmissionWindow(deadline, now);
  if (window.accepted) return null;

  // Staff may test-submit before an assignment unlocks; the late window still binds them, so
  // that testing cannot quietly become a way past a cutoff.
  if (window.reason === 'not-open') {
    return isCourseStaff ? null : { kind: 'not-open', unlockAt: deadline.unlockAt };
  }
  return window.reason === 'late-not-allowed'
    ? { kind: 'late-not-allowed' }
    : { kind: 'cutoff-passed' };
}

/**
 * The cap that applies to this submitter, from rows read at the same moment.
 *
 * Split out for the same reason as the rest: the limit used to be worked out once, before the
 * transaction, and then trusted by it. A grant revoked in between, or a lowered
 * `maxSubmissions`, was simply not seen, and the attempt went through against a cap nobody
 * still meant.
 */
export function resolveLimit(opts: {
  baseMaxSubmissions: number;
  grants: {
    targetType: 'STUDENT' | 'GROUP';
    userId: string | null;
    groupId: string | null;
    extraSubmissions: number;
  }[];
  userId: string;
  studentGroupIds: string[];
}): ReturnType<typeof effectiveMaxSubmissions> {
  return effectiveMaxSubmissions(
    opts.baseMaxSubmissions,
    opts.grants,
    opts.userId,
    opts.studentGroupIds,
  );
}

/**
 * Hold the rows the answers above depend on, for the length of a transaction.
 *
 * The assignment-problem link is what a submission attaches to, so holding it orders this
 * against anything that changes what the problem is or takes it away. The group set is held too
 * when there is one, because the group somebody is in decides whose submission set this write
 * joins, and membership edits take the same row; without it a student could be moved between
 * groups while their first submission was being written, leaving the set permanently locked with
 * the submission recorded against the group they just left.
 *
 * Group set first, then the link, and every other path that takes both does the same, so two of
 * them cannot deadlock by meeting in the middle.
 */
export async function lockSubmissionRows(
  tx: Prisma.TransactionClient,
  opts: { assignmentId: string; problemId: string; groupSetId: string | null },
): Promise<void> {
  if (opts.groupSetId) {
    await tx.$queryRaw`SELECT 1 FROM "GroupSet" WHERE "id" = ${opts.groupSetId} FOR UPDATE`;
  }
  await tx.$queryRaw`
    SELECT 1 FROM "AssignmentProblem"
    WHERE "assignmentId" = ${opts.assignmentId} AND "problemId" = ${opts.problemId}
    FOR UPDATE
  `;
}
