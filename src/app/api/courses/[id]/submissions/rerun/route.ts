import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { logError } from '@/lib/api/activity';
import { withCourseAuth } from '@/lib/api/with-auth';

/**
 * Re-queues every submission in a course, resetting each to PENDING (with a fresh
 * attempt budget) and clearing its feedback/result: the bulk counterpart to the
 * single-submission rerun. Course staff (faculty or TAs) or a system admin. Logs one
 * batch-summary event and returns the count re-queued.
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
      /**
       * Re-queue in a single statement instead of a per-row loop (which also ran a ~6-query
       * audit-log call per submission — tens of thousands of round-trips on a large course).
       *
       * Submissions already on the queue are left alone: PENDING is where this would put them
       * anyway, and a PROCESSING row is being evaluated right now, so re-queuing it produces a
       * second run of the same work and a result nobody asked for. The single-submission rerun
       * refuses those outright; here they are simply not part of the batch, because a
       * course-wide rerun is a sweep rather than a request about one submission.
       *
       * Clearing `processingToken` is what fences a worker mid-evaluation: its write is
       * conditioned on the token, so it now matches nothing. `attempts` never did that job
       * properly, since resetting it let the next claim hand the same value back.
       */
      const { count } = await prisma.submission.updateMany({
        where: { courseId, status: { notIn: ['PENDING', 'PROCESSING'] } },
        data: {
          status: 'PENDING',
          feedback: null,
          correct: null,
          attempts: 0,
          processingToken: null,
        },
      });

      // One batch-summary audit event for the whole-course rerun.
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
        category: 'SUBMISSION',
        error,
        courseId,
      });
      return NextResponse.json({ error: 'Failed to rerun submissions' }, { status: 500 });
    }
  },
  { access: 'manage', deniedAction: 'COURSE_SUBMISSIONS_RERUN_DENIED', blockWhenArchived: true },
);
