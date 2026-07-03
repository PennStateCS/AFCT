import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  try {
    const session = await auth();
    const user = session?.user;

    if (!user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!['ADMIN', 'FACULTY', 'TA'].includes(user.role)) {
      await createEnhancedActivityLog(prisma, req, {
        userId: session?.user?.id ?? null,
        action: 'SUBMISSION_RERUN_DENIED',
        severity: 'SECURITY',
        metadata: { role: session?.user?.role ?? null },
      });
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const submission = await prisma.submission.findUnique({
      where: { id },
      select: {
        id: true,
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

    if (!submission.fileName) {
      return NextResponse.json({ error: 'Submission has no file' }, { status: 400 });
    }

    const assignment = await prisma.assignment.findUnique({
      where: { id: submission.assignmentId },
      select: { courseId: true },
    });

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
        status: "PENDING",
        feedback: null,
        correct: null,
        evaluationRaw: Prisma.DbNull,
        updatedAt: new Date(),
      },
    });

    await createEnhancedActivityLog(prisma, req, {
      userId: user.id,
      action: 'SUBMISSION_RERUN',
      severity: 'INFO',
      category: 'SUBMISSION',
      courseId: assignment?.courseId ?? null,
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

    return NextResponse.json({ success: true, submission: updated }, { status: 202 });
  } catch (error) {
    console.error('POST /api/submissions/[id]/rerun error:', error);
    await createEnhancedActivityLog(prisma, req, {
      userId: null,
      action: 'SUBMISSION_RERUN_ERROR',
      severity: 'ERROR',
      metadata: { error: error instanceof Error ? error.message : 'unknown error' },
    });
    return NextResponse.json({ error: 'Failed to rerun submission' }, { status: 500 });
  }
}
