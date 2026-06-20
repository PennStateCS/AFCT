// src/lib/course-status-checks.ts
// Centralized logic for checking if a course can be archived or unpublished
import { PrismaClient } from '@prisma/client';

export async function canArchiveCourse(prisma: PrismaClient, courseId: string, startDate: string, endDate: string): Promise<{ canArchive: boolean; reason?: string }> {
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
    return { canArchive: false, reason: 'Course must not have any submitted problems or not in session to archive' };
  }

  // Check for grades
  const hasGrade = await prisma.assignmentProblemGrade.findFirst({
    where: {
      assignmentProblem: {
        assignment: {
          courseId: courseId,
        }
      },
    },
    select: { id: true },
  });
  if (hasGrade) {
    return { canArchive: false, reason: 'Course must not have any graded assignments or not in session to archive' };
  }

  return { canArchive: true };
}

export async function canUnpublishCourse(prisma: PrismaClient, courseId: string): Promise<{ canUnpublish: boolean; reason?: string }> {
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
    return { canUnpublish: false, reason: 'Course must not have any submitted problems to unpublish' };
  }

  // Check for grades
  const hasGrade = await prisma.assignmentProblemGrade.findFirst({
    where: {
      assignmentProblem: {
        assignment: {
          courseId: courseId,
        }
      },
    },
    select: { id: true },
  });
  if (hasGrade) {
    return { canUnpublish: false, reason: 'Course must not have any graded assignments to unpublish' };
  }

  return { canUnpublish: true };
}
