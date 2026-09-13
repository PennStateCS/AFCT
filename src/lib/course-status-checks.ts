import type { Prisma } from '@prisma/client';

/**
 * Hold every row a course's student work hangs off, for the length of a transaction.
 *
 * The lifecycle checks below ask "has anybody handed anything in yet", and the answer decides
 * whether a course may be archived or unpublished. Asking and then updating is a check-then-act:
 * both ran as separate statements, so a submission arriving in between was disallowed by a
 * decision taken before it existed, and a student could lose access to work AFCT had just
 * accepted.
 *
 * Submissions and grades reach a course through its assignment-problem links, so those are the
 * rows to hold: inserting either takes `FOR KEY SHARE` on one of them, which `FOR UPDATE`
 * conflicts with. Whichever transaction arrives first wins and the other waits, which leaves
 * only the two consistent orders. Locking the course row instead would do nothing, because no
 * submission references it directly.
 *
 * These are rare administrative actions on a course, so holding the links briefly is cheap.
 */
export async function lockCourseWork(
  tx: Prisma.TransactionClient,
  courseId: string,
): Promise<void> {
  await tx.$queryRaw`
    SELECT 1 FROM "AssignmentProblem" ap
    JOIN "Assignment" a ON a."id" = ap."assignmentId"
    WHERE a."courseId" = ${courseId}
    FOR UPDATE OF ap
  `;
}

// src/lib/course-status-checks.ts
// Centralized logic for checking if a course can be archived or unpublished
import type { PrismaClient } from '@prisma/client';

export async function canArchiveCourse(
  // Either client: these run inside the transaction that makes the change now, so that the
  // answer cannot go stale between the check and the update.
  prisma: PrismaClient | Prisma.TransactionClient,
  courseId: string,
  startDate: string,
  endDate: string,
): Promise<{ canArchive: boolean; reason?: string }> {
  // Check if the course is in session
  const inSession = new Date(startDate) <= new Date() && new Date() <= new Date(endDate);
  if (!inSession) return { canArchive: true };

  // Check for submissions
  const hasSubmission = await prisma.submission.findFirst({
    where: {
      assignmentProblem: {
        assignment: {
          courseId: courseId,
        },
      },
    },
    select: { id: true },
  });
  if (hasSubmission) {
    return {
      canArchive: false,
      reason: 'Course must not have any submitted problems or not in session to archive',
    };
  }

  // Check for grades
  const hasGrade = await prisma.assignmentProblemGrade.findFirst({
    where: {
      assignmentProblem: {
        assignment: {
          courseId: courseId,
        },
      },
    },
    select: { id: true },
  });
  if (hasGrade) {
    return {
      canArchive: false,
      reason: 'Course must not have any graded assignments or not in session to archive',
    };
  }

  return { canArchive: true };
}

export async function canUnpublishCourse(
  prisma: PrismaClient | Prisma.TransactionClient,
  courseId: string,
): Promise<{ canUnpublish: boolean; reason?: string }> {
  // Check for submissions
  const hasSubmission = await prisma.submission.findFirst({
    where: {
      assignmentProblem: {
        assignment: {
          courseId: courseId,
        },
      },
    },
    select: { id: true },
  });
  if (hasSubmission) {
    return {
      canUnpublish: false,
      reason: 'Course must not have any submitted problems to unpublish',
    };
  }

  // Check for grades
  const hasGrade = await prisma.assignmentProblemGrade.findFirst({
    where: {
      assignmentProblem: {
        assignment: {
          courseId: courseId,
        },
      },
    },
    select: { id: true },
  });
  if (hasGrade) {
    return {
      canUnpublish: false,
      reason: 'Course must not have any graded assignments to unpublish',
    };
  }

  return { canUnpublish: true };
}

/**
 * Hold the rows an assignment's student work hangs off, for the length of a transaction.
 *
 * The assignment-scoped counterpart of `lockCourseWork`, and the synchronisation point the
 * unpublish guard shares with `createSubmission`. A submission locks its assignment-problem
 * link (`lib/submission-eligibility`) and then re-reads the assignment under it, so holding the
 * same links here is what puts the two in some order instead of letting them pass each other.
 *
 * The assignment's own row is taken as well, and not only for symmetry with the delete: an
 * assignment with no problem links yet has nothing for the second statement to hold, and a
 * problem being attached to it at that moment would bring a link this never saw. Attaching one
 * takes `FOR KEY SHARE` on the assignment through its foreign key, which `FOR UPDATE` blocks.
 *
 * Assignment first, then the links. Nothing takes them the other way round: a submission never
 * touches the assignment's row at all, because `Submission` references the link rather than the
 * assignment, so there is no pair here that could meet in the middle.
 */
export async function lockAssignmentWork(
  tx: Prisma.TransactionClient,
  assignmentId: string,
): Promise<void> {
  await tx.$queryRaw`SELECT 1 FROM "Assignment" WHERE "id" = ${assignmentId} FOR UPDATE`;
  await tx.$queryRaw`
    SELECT 1 FROM "AssignmentProblem" WHERE "assignmentId" = ${assignmentId} FOR UPDATE
  `;
}

/**
 * Why this assignment may not be unpublished, or null when it may be.
 *
 * An assignment that students have handed work in against, or that carries marks, stays
 * published: unpublishing hides it, and hidden work is work a student cannot see and an
 * instructor can forget. Submissions are reported before grades because a submission is the
 * more useful thing to tell somebody about.
 *
 * Takes a client rather than reaching for `prisma`, because the only reading that counts is the
 * one taken inside the transaction that does the update, with `lockAssignmentWork` held.
 */
export async function unpublishBlockedBy(
  tx: Prisma.TransactionClient,
  assignmentId: string,
): Promise<'submissions' | 'grades' | null> {
  const [submissionCount, gradeCount] = await Promise.all([
    tx.submission.count({ where: { assignmentId } }),
    tx.assignmentProblemGrade.count({ where: { assignmentId } }),
  ]);
  if (submissionCount > 0) return 'submissions';
  if (gradeCount > 0) return 'grades';
  return null;
}
