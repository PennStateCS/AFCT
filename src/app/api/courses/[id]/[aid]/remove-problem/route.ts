import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST(req: Request, context: { params: { id: string; aid: string } }) {
  const { id: courseId, aid: assignmentId } = await context.params;
  const { problemId } = await req.json();

  if (!problemId) {
    return NextResponse.json({ error: 'Missing problemId.' }, { status: 400 });
  }

  // Safety: verify assignment belongs to the course
  const assignment = await prisma.assignment.findFirst({
    where: { id: assignmentId, courseId },
  });
  if (!assignment) {
    return NextResponse.json({ error: 'Assignment not found.' }, { status: 404 });
  }

  // Safety: verify problem belongs to the same course
  const problem = await prisma.problem.findFirst({
    where: { id: problemId, courseId },
  });
  if (!problem) {
    return NextResponse.json({ error: 'Problem not found in this course.' }, { status: 404 });
  }

  try {
    // Remove the assignment-problem link
    await prisma.assignmentProblem.deleteMany({
      where: {
        assignmentId,
        problemId,
      },
    });

    // Return updated problem list for this assignment
    const updated = await prisma.assignment.findUnique({
      where: { id: assignmentId },
      include: {
        problems: {
          include: { problem: true },
        },
      },
    });

    const problems = updated?.problems.map((ap) => ap.problem) || [];

    return NextResponse.json({ success: true, problems });
  } catch (error) {
    console.error('Error removing problem from assignment:', error);
    return NextResponse.json({ error: 'Failed to remove problem.' }, { status: 500 });
  }
}
