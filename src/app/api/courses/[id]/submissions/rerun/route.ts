import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { logError } from '@/lib/api/activity';
import { withCourseAuth } from '@/lib/api/with-auth';

/**
 * Re-queues every submission in a course, resetting each to PENDING and clearing its
 * feedback/result — the bulk counterpart to the single-submission rerun. Course staff
 * (faculty or TAs) or a system admin. Logs each submission plus one batch-summary
 * event, and returns the count re-queued.
 * @openapi
 * summary: Rerun all submissions in a course
 * parameters:
 *   - { name: id, in: path, required: true, description: Course id, schema: { type: string } }
 * responses:
 *   202:
 *     description: Submissions re-queued; returns the count.
 *     content:
 *       application/json:
 *         schema: { type: object, properties: { success: { type: boolean }, count: { type: integer } } }
 *   401: { description: Not signed in. }
 *   403: { description: Caller is not course staff or a system admin. }
 *   500: { description: Server error. }
 */
export const POST = withCourseAuth(
  async (req, ctx, { user, courseId }) => {
    try {
      const submissions = await prisma.submission.findMany({
        where: { courseId },
        select: {
          id: true,
          courseId: true,
          assignmentId: true,
          problemId: true,
          studentId: true,
        },
      });

      let count = 0;
      for (const submission of submissions) {
        await prisma.submission.update({
          where: { id: submission.id },
          data: {
            status: 'PENDING',
            feedback: null,
            correct: null,
            updatedAt: new Date(),
          },
        });

        await createEnhancedActivityLog(prisma, req, {
          userId: user.id,
          action: 'SUBMISSION_RERUN',
          severity: 'INFO',
          category: 'SUBMISSION',
          courseId: submission.courseId,
          assignmentId: submission.assignmentId,
          problemId: submission.problemId,
          submissionId: submission.id,
          metadata: {
            userId: user.id,
            assignmentId: submission.assignmentId,
            problemId: submission.problemId,
            submissionId: submission.id,
            studentId: submission.studentId,
            status: 'PENDING',
          },
        });
        count += 1;
      }

      // Batch-level summary so the whole-course rerun is recorded as one action
      // (in addition to the per-submission events), capturing the intended scope.
      await createEnhancedActivityLog(prisma, req, {
        userId: user.id,
        action: 'COURSE_SUBMISSIONS_RERUN',
        severity: 'INFO',
        category: 'SUBMISSION',
        courseId,
        metadata: { userId: user.id, courseId, count },
      });

      return NextResponse.json({ success: true, count }, { status: 202 });
    } catch (error) {
      console.error('POST /api/courses/[id]/submissions/rerun error:', error);
      await logError(req, {
        userId: user.id,
        action: 'COURSE_SUBMISSIONS_RERUN_ERROR',
        error,
        courseId,
      });
      return NextResponse.json({ error: 'Failed to rerun submissions' }, { status: 500 });
    }
  },
  { access: 'manage', deniedAction: 'COURSE_SUBMISSIONS_RERUN_DENIED', blockWhenArchived: true },
);
