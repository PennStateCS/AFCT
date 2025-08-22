import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const resolvedParams = await params;
    const problemId = resolvedParams.id;
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('userId');

    // Verify user is either requesting their own submissions or is an instructor/faculty
    if (userId && userId !== session.user.id && 
        session.user.role !== 'FACULTY' && 
        session.user.role !== 'ADMIN' && 
        session.user.role !== 'TA') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // If no userId specified, use the current user's ID
    const targetUserId = userId || session.user.id;

    // Fetch submissions for the problem and user
    const submissions = await prisma.submission.findMany({
      where: {
        problemId: problemId,
        studentId: targetUserId,
      },
      orderBy: {
        submittedAt: 'desc',
      },
      select: {
        id: true,
        submittedAt: true,
        feedback: true,
        correct: true,
        fileName: true,
        originalFileName: true,
        problemId: true,
      },
    });

    // Transform submissions to match the expected format
    const formattedSubmissions = submissions.map(submission => ({
      id: submission.id,
      submittedAt: submission.submittedAt.toISOString(),
      feedback: submission.feedback,
      correct: submission.correct,
      fileName: submission.fileName,
      originalFileName: submission.originalFileName,
      problemId: submission.problemId,
      status: 'SUBMITTED' as 'SUBMITTED' | 'GRADED' | 'LATE',
    }));

    return NextResponse.json(formattedSubmissions);
  } catch (error) {
    console.error('Error fetching submissions:', error);
    return NextResponse.json(
      { error: 'Failed to fetch submissions' },
      { status: 500 }
    );
  }
}
