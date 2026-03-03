import { NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';

const AssignmentProblemSettingsSchema = z.object({
  maxPoints: z.number().min(0),
  maxSubmissions: z
    .number()
    .int()
    .refine((value) => value === -1 || value >= 1, {
      message: 'Max submissions must be unlimited (-1) or at least 1.',
    }),
  autograderEnabled: z.boolean(),
});

type AssignmentProblemSettingsInput = z.infer<typeof AssignmentProblemSettingsSchema>;

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string; aid: string; pid: string }> },
) {
  const { id: courseId, aid: assignmentId, pid: problemId } = await params;

  try {
    const session = await auth();
    const user = session?.user;

    if (!user || !['ADMIN', 'FACULTY', 'TA'].includes(user.role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    let payload: AssignmentProblemSettingsInput;
    try {
      const body = await req.json();
      const parsed = AssignmentProblemSettingsSchema.safeParse(body);

      if (!parsed.success) {
        const message = parsed.error.issues.at(0)?.message ?? 'Invalid payload.';
        return NextResponse.json({ error: message }, { status: 400 });
      }

      payload = parsed.data;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
    }

    const link = await prisma.assignmentProblem.findUnique({
      where: {
        assignmentId_problemId: {
          assignmentId,
          problemId,
        },
      },
      include: {
        assignment: {
          select: {
            courseId: true,
          },
        },
        problem: {
          select: {
            title: true,
          },
        },
      },
    });

    if (!link || link.assignment.courseId !== courseId) {
      return NextResponse.json({ error: 'Assignment problem link not found.' }, { status: 404 });
    }

    const updated = await prisma.assignmentProblem.update({
      where: {
        assignmentId_problemId: {
          assignmentId,
          problemId,
        },
      },
      data: payload,
      select: {
        assignmentId: true,
        problemId: true,
        maxPoints: true,
        maxSubmissions: true,
        autograderEnabled: true,
      },
    });

    try {
      await createEnhancedActivityLog(prisma, req, {
        userId: user.id,
        action: 'UPDATE_ASSIGNMENT_PROBLEM_SETTINGS',
        category: 'ASSIGNMENT',
        courseId,
        assignmentId,
        problemId,
        metadata: {
          userId: user.id,
          assignmentId,
          problemId,
          courseId,
          maxPoints: payload.maxPoints,
          maxSubmissions: payload.maxSubmissions,
          autograderEnabled: payload.autograderEnabled,
          problemTitle: link.problem.title,
        },
      });
    } catch (logError) {
      console.warn('Failed to log assignment problem update:', logError);
    }

    return NextResponse.json({ success: true, assignmentProblem: updated });
  } catch (error) {
    console.error('Failed to update assignment problem settings:', error);
    return NextResponse.json(
      { error: 'Failed to update assignment problem settings.' },
      { status: 500 },
    );
  }
}
