import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { ProblemTypeEnum } from '@/schemas/problem';
import { canManageCourse } from '@/lib/permissions';
import { z } from 'zod';

// Types
interface AssignmentWithProblems {
  problems: {
    problem: {
      id: string;
      title: string;
      description: string | null;
      type: z.infer<typeof ProblemTypeEnum> | null;
      maxStates: number | null;
      isDeterministic: boolean | null;
    }
  }[]
}

/**
 * Detaches a problem from an assignment (and clears any group→problem mappings for
 * it), leaving the problem itself intact in the course. Course staff (faculty or
 * TAs) or a system admin. Both the assignment and the problem must belong to the course
 * in the path. Uses POST rather than DELETE because the problem id travels in the body.
 * @openapi
 * summary: Remove a problem from an assignment
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 *   - { name: aid, in: path, required: true, schema: { type: string } }
 * requestBody:
 *   required: true
 *   content:
 *     application/json:
 *       schema: { type: object, required: [problemId], properties: { problemId: { type: string } } }
 * responses:
 *   200: { description: The assignment's remaining problems. }
 *   400: { description: Missing problemId. }
 *   403: { description: Caller is not course staff (faculty or TA) or a system admin. }
 *   404: { description: Assignment or problem not found in this course. }
 *   500: { description: Server error. }
 */
export async function POST(
  req: Request,
  context: { params: Promise<{ id: string; aid: string }> },
) {
  const { id: courseId, aid: assignmentId } = await context.params;

  const session = await auth();
  const user = session?.user;

  if (!user || !(await canManageCourse(user, courseId))) {
    await createEnhancedActivityLog(prisma, req, {
      userId: session?.user?.id ?? null,
      action: 'ASSIGNMENT_REMOVE_PROBLEM_DENIED',
      severity: 'SECURITY',
      metadata: {},
    });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  try {
    // Parse the problemId from the request body
    const { problemId } = await req.json();

    if (!problemId) {
      return NextResponse.json({ error: 'Missing problemId.' }, { status: 400 });
    }

    // Validate that the assignment exists and belongs to the specified course
    const assignment = await prisma.assignment.findFirst({
      where: { id: assignmentId, courseId },
    });

    if (!assignment) {
      return NextResponse.json({ error: 'Assignment not found.' }, { status: 404 });
    }

    // Validate that the problem belongs to the same course
    const problem = await prisma.problem.findFirst({
      where: { id: problemId, courseId },
    });

    if (!problem) {
      return NextResponse.json({ error: 'Problem not found in this course.' }, { status: 404 });
    }

    // Delete the link between the assignment and the problem
    await prisma.assignmentProblem.deleteMany({
      where: {
        assignmentId,
        problemId,
      },
    });

    // Also remove any group-specific mappings for this assignment/problem so
    // the problem is fully unassigned from groups when removed from the
    // assignment.
    await prisma.groupAssignmentProblem.deleteMany({ where: { assignmentId, problemId } });

    // Retrieve updated problem list for this assignment
    const updated = await prisma.assignment.findUnique({
      where: { id: assignmentId },
      select: {
        problems: {
          select: {
            problem: {           
              select: {
                id: true,
                title: true,
                description: true,
                type: true,
                maxStates: true,
                isDeterministic: true,
              }
            }
          },
        },
      },
    }) as AssignmentWithProblems | null;

    const problems = updated?.problems.map((ap: NonNullable<typeof updated>['problems'][number]) => ap.problem) || [];

    // Log the removal action
    await createEnhancedActivityLog(prisma, req, {
      userId: user.id,
      action: 'REMOVE_ASSIGNMENT_PROBLEM',
      severity: 'INFO',
      category: 'ASSIGNMENT',
      courseId,
      assignmentId,
      problemId,
      metadata: {
        userId: user.id,
        courseId: courseId,
        assignmentId: assignmentId,
        problemId: problemId,
        problemTitle: problem.title,
      },
    });

    // Return the updated list of problems
    return NextResponse.json({ success: true, problems });
  } catch (error) {
    console.error('Error removing problem from assignment:', error);
    await createEnhancedActivityLog(prisma, req, {
      userId: session?.user?.id ?? null,
      action: 'ASSIGNMENT_REMOVE_PROBLEM_ERROR',
      severity: 'ERROR',
      metadata: { error: error instanceof Error ? error.message : 'unknown error' },
    });
    return NextResponse.json({ error: 'Failed to remove problem.' }, { status: 500 });
  }
}
