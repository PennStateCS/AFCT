import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { canAccessCourse, canManageCourse } from '@/lib/permissions';
import { apiError } from '@/lib/api/http';
import { logDenial } from '@/lib/api/activity';

/**
 * Lists a user's submissions for one problem, newest first. Callers see their own
 * by default; course staff (faculty or TAs) or a system admin may pass `?userId=`
 * to view another user's. Either way the caller must be able to access the
 * problem's course.
 * @openapi
 * summary: List a user's submissions for a problem
 * parameters:
 *   - { name: id, in: path, required: true, description: Problem id, schema: { type: string } }
 *   - { name: userId, in: query, description: "Whose submissions to fetch; only course staff or a system admin may fetch another user's, defaults to the caller", schema: { type: string } }
 * responses:
 *   200:
 *     description: The submissions, newest first.
 *     content:
 *       application/json:
 *         schema: { type: array, items: { type: object } }
 *   401: { description: Not signed in. }
 *   403: { description: "Not enrolled in the problem's course, or requesting another user's submissions without being course staff or a system admin." }
 *   404: { description: Problem not found. }
 *   500: { description: Server error. }
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return apiError(401, 'Unauthorized');
    }

    const resolvedParams = await params;
    const problemId = resolvedParams.id;
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('userId');
    const targetUserId = userId || session.user.id;
    const viewingOthers = targetUserId !== session.user.id;

    // Resolve the problem's course and authorize: viewing another user's work needs
    // staff (manage); viewing your own needs enrollment (access). Previously the
    // own-submissions path did no course check at all.
    const problemForAuth = await prisma.problem.findUnique({
      where: { id: problemId },
      select: { courseId: true },
    });
    if (!problemForAuth) {
      return NextResponse.json({ error: 'Problem not found' }, { status: 404 });
    }

    const allowed = viewingOthers
      ? await canManageCourse(session.user, problemForAuth.courseId)
      : await canAccessCourse(session.user, problemForAuth.courseId);
    if (!allowed) {
      return logDenial(req, {
        userId: session.user.id,
        action: 'SUBMISSION_VIEW_DENIED',
        courseId: problemForAuth.courseId,
      });
    }

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
    const formattedSubmissions = submissions.map((submission) => ({
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
    return NextResponse.json({ error: 'Failed to fetch submissions' }, { status: 500 });
  }
}
