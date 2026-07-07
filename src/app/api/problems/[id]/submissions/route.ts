import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { canManageCourse } from '@/lib/permissions';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';

/**
 * Lists a user's submissions for one problem, newest first. Callers see their own
 * by default; staff (FACULTY/TA/ADMIN) may pass `?userId=` to view another user's.
 * @openapi
 * summary: List a user's submissions for a problem
 * parameters:
 *   - { name: id, in: path, required: true, description: Problem id, schema: { type: string } }
 *   - { name: userId, in: query, description: "Whose submissions to fetch; staff only for others, defaults to the caller", schema: { type: string } }
 * responses:
 *   200:
 *     description: The submissions, newest first.
 *     content:
 *       application/json:
 *         schema: { type: array, items: { type: object } }
 *   401: { description: Not signed in. }
 *   403: { description: Requesting another user's submissions without a staff role. }
 *   500: { description: Server error. }
 */
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

    // Verify user is either requesting their own submissions or is course staff
    if (userId && userId !== session.user.id) {
      const problemForAuth = await prisma.problem.findUnique({
        where: { id: problemId },
        select: { courseId: true },
      });
      if (!problemForAuth) {
        return NextResponse.json({ error: 'Problem not found' }, { status: 404 });
      }
      if (!(await canManageCourse(session.user, problemForAuth.courseId))) {
        await createEnhancedActivityLog(prisma, req, {
          userId: session?.user?.id ?? null,
          action: 'SUBMISSION_VIEW_DENIED',
          severity: 'SECURITY',
          metadata: {},
        });
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
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
        status: true,
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
      status: submission.status,
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
