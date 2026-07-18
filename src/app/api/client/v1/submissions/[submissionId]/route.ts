import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withClientAuth } from '@/lib/api/with-client-auth';
import { apiError } from '@/lib/api/http';
import { canAccessCourse, canManageCourse, canViewStudentData, isAdmin } from '@/lib/permissions';

type RouteCtx = { params: Promise<{ submissionId: string }> };

/**
 * The result of one submission, for polling after a submit. Returns the queue
 * `status` (PENDING/PROCESSING/COMPLETED/FAILED) and, once evaluated, whether it was
 * `correct`, the `grade`, and the `feedback` (the witness / counterexample string).
 * A caller may read their own submission; staff may read anyone's in their course.
 * Anything else is masked as 404.
 * @openapi
 * summary: Get a submission's result (client)
 * parameters:
 *   - { name: submissionId, in: path, required: true, schema: { type: string } }
 * responses:
 *   200:
 *     description: The submission's status and (when done) result.
 *     content:
 *       application/json:
 *         schema:
 *           type: object
 *           properties:
 *             id: { type: string }
 *             status: { type: string }
 *             correct: { type: boolean, nullable: true }
 *             grade: { type: number, nullable: true }
 *             feedback: { type: string, nullable: true, description: The witness / counterexample }
 *   401: { description: Missing or invalid token. }
 *   404: { description: Submission not found or not visible to the caller. }
 */
export const GET = withClientAuth(async (_req, ctx: RouteCtx, { user }) => {
  const { submissionId } = await ctx.params;

  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
    select: {
      id: true,
      studentId: true,
      studentGroupId: true,
      courseId: true,
      assignmentId: true,
      problemId: true,
      status: true,
      correct: true,
      feedback: true,
    },
  });

  // Hide existence: not found, or the caller may not see this student's work. A group
  // submission (studentGroupId set) is visible to any groupmate, so let
  // canViewStudentData widen to the group in that case.
  if (
    !submission ||
    !(await canViewStudentData(user, submission.courseId, submission.studentId, {
      groupAssignment: submission.studentGroupId != null,
    }))
  ) {
    return apiError(404, 'Submission not found');
  }

  // canViewStudentData lets a student see their own work unconditionally; for
  // this route, mirror the web's student view: non-staff also need current course
  // access and a published assignment (a student removed from the roster loses
  // access here the same way the browser hides it).
  const staff = isAdmin(user) || (await canManageCourse(user, submission.courseId));
  if (!staff) {
    const assignment = await prisma.assignment.findUnique({
      where: { id: submission.assignmentId },
      select: { isPublished: true },
    });
    if (!assignment?.isPublished || !(await canAccessCourse(user, submission.courseId))) {
      return apiError(404, 'Submission not found');
    }
  }

  // The grade lives on the per-problem grade record, not the submission.
  const gradeRow = await prisma.assignmentProblemGrade.findUnique({
    where: {
      assignmentId_problemId_studentId: {
        assignmentId: submission.assignmentId,
        problemId: submission.problemId,
        studentId: submission.studentId,
      },
    },
    select: { grade: true },
  });

  return NextResponse.json({
    id: submission.id,
    status: submission.status,
    correct: submission.correct,
    grade: gradeRow?.grade ?? null,
    feedback: submission.feedback,
  });
});
