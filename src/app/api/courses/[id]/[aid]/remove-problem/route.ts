// /src/api/courses/[id]/[aid]/remove-problem/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string; aid: string }> },
) {
  const { id: courseId, aid: assignmentId } = await context.params;

  // Get the user session and check for required roles
  const session = await auth();
  const user = session?.user;

  if (!user || !['ADMIN', 'FACULTY', 'TA'].includes(user.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

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

  try {
    // Delete the link between the assignment and the problem
    await prisma.assignmentProblem.deleteMany({
      where: {
        assignmentId,
        problemId,
      },
    });

    // Retrieve updated problem list for this assignment
    const updated = await prisma.assignment.findUnique({
      where: { id: assignmentId },
      include: {
        problems: {
          include: { problem: true },
        },
      },
    });

    const problems = updated?.problems.map((ap) => ap.problem) || [];

    // Log the removal action
    await createEnhancedActivityLog(prisma, req, {
      userId: user.id,
      action: 'REMOVE_ASSIGNMENT_PROBLEM',
      category: 'ASSIGNMENT',
      courseId,
      assignmentId,
      problemId,
      metadata: {},
    });

    // Return the updated list of problems
    return NextResponse.json({ success: true, problems });
  } catch (error) {
    console.error('Error removing problem from assignment:', error);
    return NextResponse.json({ error: 'Failed to remove problem.' }, { status: 500 });
  }
}
