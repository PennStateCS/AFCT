import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST(req: Request, { params }: { params: { id: string; aid: string } }) {
  const { id: courseId, aid: assignmentId } = params;

  try {
    const body = await req.json();
    const problemIds: string[] = Array.isArray(body.problemIds) ? body.problemIds : [];

    // Validate problems belong to this course
    const validProblems = await prisma.problem.findMany({
      where: {
        id: { in: problemIds },
        courseId,
      },
      select: { id: true },
    });

    const validIds = validProblems.map((p) => p.id);

    // Delete current links for this assignment (restricted to the same course)
    await prisma.assignmentProblem.deleteMany({
      where: {
        assignmentId,
        assignment: {
          courseId,
        },
      },
    });

    // Create new links if valid problems exist
    if (validIds.length > 0) {
      await prisma.assignmentProblem.createMany({
        data: validIds.map((pid) => ({
          assignmentId,
          problemId: pid,
        })),
      });
    }

    // Return updated problems for this assignment
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
  } catch (err) {
    console.error('Failed to update assignment problems:', err);
    return NextResponse.json({ error: 'Failed to update assignment problems.' }, { status: 500 });
  }
}
