import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withClientAuth } from '@/lib/api/with-client-auth';
import { apiError } from '@/lib/api/http';
import { canAccessCourse, canManageCourse, canViewStudentData, isAdmin } from '@/lib/permissions';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { discloseSubmissionFeedback, feedbackVisibilityMap } from '@/lib/feedback-visibility';

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
 *             feedbackVisible: { type: boolean, description: "False when the problem withholds the evaluator's feedback from students. Distinguishes a withheld result from one the evaluator had nothing to say about, since feedback is null in both cases." }
 *   401: { description: Missing or invalid token. }
 *   404: { description: Submission not found or not visible to the caller. }
 */
export const GET = withClientAuth(async (req, ctx: RouteCtx, { user }) => {
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
      assignmentProblem: { select: { showFeedback: true } },
    },
  });

  // Hide existence: not found, or the caller may not see this student's work. A group
  // submission is visible to a member of the group that owns it — scoped to that exact
  // group, not merely any group shared with the owner (a course can have several group
  // sets, and groupmates in one set must not read work submitted under another).
  if (
    !submission ||
    !(await canViewStudentData(user, submission.courseId, submission.studentId, {
      studentGroupId: submission.studentGroupId,
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

  // Staff reading a student's work is a disclosure and belongs in the log, the same as
  // the web review-data route. Students poll this endpoint for their own result, which is
  // not a disclosure, so logging it would bury the staff reads under polling traffic.
  if (staff && user.id !== submission.studentId) {
    await createEnhancedActivityLog(prisma, req, {
      userId: user.id,
      action: 'VIEW_STUDENT_SUBMISSION',
      severity: 'INFO',
      category: 'SUBMISSION',
      courseId: submission.courseId,
      assignmentId: submission.assignmentId,
      submissionId: submission.id,
      metadata: { viewedStudentId: submission.studentId, source: 'client' },
    });
  }

  // What this caller is allowed to read. Staff keep everything; a student gets the evaluator's
  // text only where the problem shows it, plus a flag so the client can say which it is.
  const disclosure = discloseSubmissionFeedback(
    submission,
    feedbackVisibilityMap([
      {
        problemId: submission.problemId,
        showFeedback: submission.assignmentProblem?.showFeedback !== false,
      },
    ]),
    { isStaff: staff },
  );

  return NextResponse.json({
    id: submission.id,
    status: submission.status,
    correct: submission.correct,
    grade: gradeRow?.grade ?? null,
    feedback: disclosure.feedback,
    feedbackVisible: disclosure.feedbackVisible,
  });
});
