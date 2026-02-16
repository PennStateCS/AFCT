import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';

// GET: Count of groups that have a said problem for an assignment
export async function POST(
  req: Request,
  context: { params: Promise<{ id: string; aid: string; }> },
) {
  const { id: courseId, aid: assignmentId } = await context.params;
  const { problemId } = await req.json();

  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    if (!problemId) {
      return NextResponse.json({ error: 'Missing problemId' }, { status: 400 });
    }

    // Find all groupAssignmentProblem records for this assignment/problem
    const groupProblems = await prisma.groupAssignmentProblem.findMany({
      where: { assignmentId, problemId },
      select: { groupId: true },
    });
    
    // Return array of groupIds
    return NextResponse.json({ success: true, groups: groupProblems.map(gp => gp.groupId) });
  } catch (err) {
    console.error('Failed to fetch group problems:', err);
    return NextResponse.json({ error: 'Failed to fetch group problems' }, { status: 500 });
  }
}

// DELETE: Remove a group-problem record for an assignment
export async function DELETE(
  req: Request,
  context: { params: Promise<{ id: string; aid: string; }> },
) {
  const { id: courseId, aid: assignmentId } = await context.params;
  const { problemId, groupId } = await req.json();

  try {
    if (!problemId || !groupId) {
      return NextResponse.json({ error: 'Missing problemId or groupId' }, { status: 400 });
    }
    await prisma.groupAssignmentProblem.delete({ where: { assignmentId_problemId_groupId: { assignmentId, problemId, groupId } } });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Failed to remove group problem (DELETE):', err);
    return NextResponse.json({ error: 'Failed to remove group problem' }, { status: 500 });
  }
}
