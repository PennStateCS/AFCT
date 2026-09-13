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
