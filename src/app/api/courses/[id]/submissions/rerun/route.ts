import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { getClientIp } from '@/lib/security/rate-limiter';

/** Rows per audit insert. Large enough that a sweep is a few statements, not thousands. */
const AUDIT_CHUNK = 500;
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
      // `updateManyAndReturn` so the ids come from the statement that changed them. Selecting
      // first would race: a submission arriving between the two ends up re-queued but unlogged,
      // or logged but untouched.
      const reset = await prisma.submission.updateManyAndReturn({
        where: { courseId, status: { notIn: ['PENDING', 'PROCESSING'] } },
        data: {
          status: 'PENDING',
          feedback: null,
          correct: null,
          // The old result is gone, so the time it landed is gone with it.
          evaluatedAt: null,
          attempts: 0,
          processingToken: null,
        },
        select: { id: true, assignmentId: true, problemId: true, studentId: true },
      });
      const count = reset.length;

      /**
       * One entry per submission, then the summary, joined by `batchId`. Every one of these
       * gets re-graded, and the worker's SUBMISSION_AUTOGRADED entry looks like an ordinary
       * first grading, so without this a changed mark has nothing linking it to whoever
       * ordered the sweep.
       *
       * `submissionId` in the column, not just metadata: it is indexed, and per-submission
       * history is the point. Chunked `createMany` rather than the helper, which costs several
       * queries per call.
       */
      const batchId = randomUUID();
      const ip = getClientIp(req);
      const userAgent = req.headers.get('user-agent') ?? null;

      for (let i = 0; i < reset.length; i += AUDIT_CHUNK) {
        await prisma.activityLog.createMany({
          data: reset.slice(i, i + AUDIT_CHUNK).map((row) => ({
            userId: user.id,
            action: 'SUBMISSION_RERUN',
            severity: 'INFO' as const,
            category: 'SUBMISSION' as const,
            courseId,
            assignmentId: row.assignmentId,
            problemId: row.problemId,
            submissionId: row.id,
            ipAddress: ip,
            userAgent,
            metadata: { batchId, via: 'course-rerun', targetUserId: row.studentId },
          })),
        });
      }

      // One batch-summary audit event for the whole-course rerun.
      await createEnhancedActivityLog(prisma, req, {
        userId: user.id,
        action: 'COURSE_SUBMISSIONS_RERUN',
        severity: 'INFO',
        category: 'SUBMISSION',
        courseId,
        // The id the per-submission rows carry, so the sweep reads from either end.
        metadata: { userId: user.id, courseId, count, batchId },
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
