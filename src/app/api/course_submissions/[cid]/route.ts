import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';

export async function POST(req: Request, context: { params: Promise<{ cid: string }> }) {
  const { cid } = await context.params;

  try {
    const session = await auth();
    const user = session?.user;

    if (!user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!['ADMIN', 'FACULTY', 'TA'].includes(user.role)) {
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

    var updated_count: number  = 0;
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

    return NextResponse.json({ success: true, count: updated_count }, { status: 202 });
  } catch (error) {
    console.error('POST /api/submissions/[id]/rerun error:', error);
    return NextResponse.json({ error: 'Failed to rerun submission' }, { status: 500 });
  }
}
