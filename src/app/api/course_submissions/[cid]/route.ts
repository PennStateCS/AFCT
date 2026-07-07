import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';

export async function POST(req: Request, context: { params: Promise<{ cid: string }> }) {
  const { cid } = await context.params;
  let actorId: string | null = null;

  try {
    const session = await auth();
    const user = session?.user;
    actorId = user?.id ?? null;

    if (!user?.id) {
      await createEnhancedActivityLog(prisma, req, {
        userId: null,
        action: 'COURSE_SUBMISSIONS_RERUN_DENIED',
        severity: 'SECURITY',
        courseId: cid,
        metadata: { role: null },
      });
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!['ADMIN', 'FACULTY', 'TA'].includes(user.role)) {
      await createEnhancedActivityLog(prisma, req, {
        userId: session?.user?.id ?? null,
        action: 'COURSE_SUBMISSIONS_RERUN_DENIED',
        severity: 'SECURITY',
        metadata: { role: session?.user?.role ?? null },
      });
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const submissions = await prisma.submission.findMany({
      where: { courseId: cid },
      select: {
        id: true,
        courseId: true,
        assignmentId: true,
        problemId: true,
      },
    });

    let updated_count: number  = 0;
    for(const submission of submissions) {
        await prisma.submission.update({
            where: { id: submission.id },
            data: {
                status: "PENDING",
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
                status: 'PENDING'
            },
        });
        updated_count += 1;
    }

    // Batch-level summary so the whole-course rerun is recorded as one action
    // (in addition to the per-submission events), capturing the intended scope.
    await createEnhancedActivityLog(prisma, req, {
      userId: user.id,
      action: 'COURSE_SUBMISSIONS_RERUN',
      severity: 'INFO',
      category: 'SUBMISSION',
      courseId: cid,
      metadata: { userId: user.id, courseId: cid, count: updated_count },
    });

    return NextResponse.json({ success: true, count: updated_count }, { status: 202 });
  } catch (error) {
    console.error('POST /api/course_submissions/[cid] rerun error:', error);
    await createEnhancedActivityLog(prisma, req, {
      userId: actorId,
      action: 'COURSE_SUBMISSIONS_RERUN_ERROR',
      severity: 'ERROR',
      courseId: cid,
      metadata: { error: error instanceof Error ? error.message : 'unknown error' },
    });
    return NextResponse.json({ error: 'Failed to rerun submission' }, { status: 500 });
  }
}
