'use server';

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { canManageCourse } from '@/lib/permissions';
import { logError } from '@/lib/api/activity';

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
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
      },
    });

    if (!submission) {
      return NextResponse.json({ error: 'Submission not found' }, { status: 404 });
    }

    if (!(await canManageCourse(user, submission.courseId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body.isSuspiciousOverride !== 'boolean') {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const updated = await prisma.submission.update({
      where: { id },
      data: { isSuspiciousOverride: body.isSuspiciousOverride },
    });

    await createEnhancedActivityLog(prisma, req, {
      userId: user.id,
      action: 'SUBMISSION_SUSPICIOUS_OVERRIDE',
      severity: 'INFO',
      category: 'SUBMISSION',
      courseId: submission.courseId,
      assignmentId: submission.assignmentId,
      problemId: submission.problemId,
      submissionId: submission.id,
      metadata: {
        submissionId: submission.id,
        isSuspiciousOverride: body.isSuspiciousOverride,
      },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error('PATCH /api/submissions/[id] error:', error);
    await logError(req, {
      userId: actorId,
      action: 'SUBMISSION_SUSPICIOUS_OVERRIDE_ERROR',
      category: 'SUBMISSION',
      error,
      metadata: { submissionId: id },
    });
    return NextResponse.json({ error: 'Failed to update submission' }, { status: 500 });
  }
}
