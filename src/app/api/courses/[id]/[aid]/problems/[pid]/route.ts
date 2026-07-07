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

/**
 * Updates the per-assignment settings for one problem: its point value, submission
 * cap, and whether the autograder runs. Staff only (ADMIN/FACULTY/TA). The problem
 * must already be linked to the assignment, and the assignment must belong to the
 * course in the path.
 * @openapi
 * summary: Update an assignment problem's settings
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 *   - { name: aid, in: path, required: true, schema: { type: string } }
 *   - { name: pid, in: path, required: true, schema: { type: string } }
 * requestBody:
 *   required: true
 *   content:
 *     application/json:
 *       schema:
 *         type: object
 *         required: [maxPoints, maxSubmissions, autograderEnabled]
 *         properties:
 *           maxPoints: { type: number, minimum: 0 }
 *           maxSubmissions: { type: integer, description: -1 for unlimited, else >= 1 }
 *           autograderEnabled: { type: boolean }
 * responses:
 *   200: { description: The updated assignment-problem settings. }
 *   400: { description: Invalid JSON or settings. }
 *   403: { description: Caller lacks a staff role. }
 *   404: { description: The problem isn't linked to this assignment/course. }
 *   500: { description: Server error. }
 */
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string; aid: string; pid: string }> },
) {
  const { id: courseId, aid: assignmentId, pid: problemId } = await params;

  try {
    const session = await auth();
    const user = session?.user;

    if (!user || !['ADMIN', 'FACULTY', 'TA'].includes(user.role)) {
      await createEnhancedActivityLog(prisma, req, {
        userId: session?.user?.id ?? null,
        action: 'ASSIGNMENT_PROBLEM_SETTINGS_UPDATE_DENIED',
        severity: 'SECURITY',
        metadata: { role: session?.user?.role ?? null },
      });
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
        severity: 'INFO',
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
    await createEnhancedActivityLog(prisma, req, {
      userId: null,
      action: 'ASSIGNMENT_PROBLEM_SETTINGS_UPDATE_ERROR',
      severity: 'ERROR',
      metadata: { error: error instanceof Error ? error.message : 'unknown error' },
    });
    return NextResponse.json(
      { error: 'Failed to update assignment problem settings.' },
      { status: 500 },
    );
  }
}
