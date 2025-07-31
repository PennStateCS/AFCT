import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import path from 'path';
import { promises as fs } from 'fs';

export async function DELETE(req: Request, context: { params: { id: string; pid: string } }) {
  const { id: courseId, pid: problemId } = context.params;

  try {
    // Verify the problem belongs to this course
    const problem = await prisma.problem.findFirst({
      where: { id: problemId, courseId },
    });

    if (!problem) {
      return NextResponse.json({ error: 'Problem not found.' }, { status: 404 });
    }

    // Delete related submissions first
    await prisma.submission.deleteMany({
      where: { problemId: problemId },
    });

    // Delete AssignmentProblem links
    await prisma.assignmentProblem.deleteMany({
      where: { problemId: problemId },
    });

    // Delete the problem itself
    await prisma.problem.delete({
      where: { id: problemId },
    });

    // Remove the associated solution file if it exists
    if (problem.fileName) {
      const filePath = path.join(process.cwd(), 'public', 'uploads', 'solutions', problem.fileName);
      try {
        await fs.unlink(filePath);
      } catch (fsErr: any) {
        if (fsErr.code !== 'ENOENT') {
          console.error('Error deleting solution file:', fsErr);
        }
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('API DELETE error:', error);
    return NextResponse.json({ error: 'Failed to delete problem.' }, { status: 500 });
  }
}
