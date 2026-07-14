import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { logError } from '@/lib/api/activity';
import { canManageCourse } from '@/lib/permissions';

/**
 * Re-queues one submission for evaluation, resetting it to PENDING and clearing its
 * prior feedback/result. Course staff (faculty or TAs) or a system admin. The
 * submission must have a stored file and its problem must still be linked to the
 * assignment.
 * @openapi
 * summary: Rerun a submission
 * parameters:
 *   - { name: id, in: path, required: true, description: Submission id, schema: { type: string } }
 * responses:
 *   202: { description: Submission re-queued (status PENDING). }
 *   400: { description: "Submission has no file, or its problem is no longer linked." }
 *   401: { description: Not signed in. }
 *   403: { description: Caller is not course staff or a system admin. }
 *   404: { description: Submission not found. }
 *   500: { description: Server error. }
 */
export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  let actorId: string | null = null;

  try {
    const session = await auth();
    const user = session?.user;
    actorId = user?.id ?? null;

    if (!user?.id || user.inactive) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const submission = await prisma.submission.findUnique({
      where: { id },
      select: {
        id: true,
        courseId: true,
        assignmentId: true,
        problemId: true,
        studentId: true,
        fileName: true,
        originalFileName: true,
      },
    });

    if (!submission) {
      return NextResponse.json({ error: 'Submission not found' }, { status: 404 });
    }

    if (!(await canManageCourse(user, submission.courseId))) {
      await createEnhancedActivityLog(prisma, req, {
        userId: session?.user?.id ?? null,
        action: 'SUBMISSION_RERUN_DENIED',
        severity: 'SECURITY',
        courseId: submission.courseId,
        metadata: { submissionId: submission.id, studentId: submission.studentId },
      });
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (!submission.fileName) {
      return NextResponse.json({ error: 'Submission has no file' }, { status: 400 });
    }

    const link = await prisma.assignmentProblem.findUnique({
      where: {
        assignmentId_problemId: {
          assignmentId: submission.assignmentId,
          problemId: submission.problemId,
        },
      },
      include: {
        problem: {
          select: {
            fileName: true,
            maxStates: true,
            isDeterministic: true,
            type: true,
          },
        },
      },
    });

    if (!link) {
      return NextResponse.json(
        { error: 'Problem is not linked to this assignment.' },
        { status: 400 },
      );
    }

    const updated = await prisma.submission.update({
      where: { id },
      data: {
        status: 'PENDING',
        feedback: null,
        correct: null,
        evaluationRaw: Prisma.DbNull,
        // Fresh attempt budget, and fences any worker mid-processing this row (its
        // claimed attempts value no longer matches, so its stale write no-ops).
        attempts: 0,
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

    return NextResponse.json({ success: true, submission: updated }, { status: 202 });
  } catch (error) {
    console.error('POST /api/submissions/[id]/rerun error:', error);
    await logError(req, {
      userId: actorId,
      action: 'SUBMISSION_RERUN_ERROR',
      error,
      metadata: { submissionId: id },
    });
    return NextResponse.json({ error: 'Failed to rerun submission' }, { status: 500 });
  }
}
