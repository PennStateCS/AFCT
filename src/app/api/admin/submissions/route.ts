import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { isAdmin } from '@/lib/permissions';

/**
 * Returns every submission across a set of problems, flattened for the admin
 * grading view — student, course, assignment/problem titles, status, and the
 * recorded grade (joined from AssignmentProblemGrade). System administrators only.
 * Takes the problem ids in the body rather than the query string since the list
 * can be long.
 * @openapi
 * summary: List submissions for problems (admin)
 * requestBody:
 *   required: true
 *   content:
 *     application/json:
 *       schema:
 *         type: object
 *         required: [problemIds]
 *         properties:
 *           problemIds: { type: array, items: { type: string } }
 * responses:
 *   200:
 *     description: Flattened submissions, newest first.
 *     content:
 *       application/json:
 *         schema: { type: array, items: { type: object } }
 *   400: { description: problemIds missing or empty. }
 *   401: { description: Not signed in. }
 *   403: { description: Caller is not a system administrator. }
 *   500: { description: Server error. }
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!isAdmin(session?.user)) {
      await createEnhancedActivityLog(prisma, req, {
        userId: session?.user?.id ?? null,
        action: 'ADMIN_SUBMISSIONS_ACCESS_DENIED',
        severity: 'SECURITY',
        metadata: {},
      });
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await req.json();
    const problemIds = Array.isArray(body?.problemIds) ? body.problemIds : [];

    if (problemIds.length === 0) {
      return NextResponse.json({ error: 'Missing problemIds' }, { status: 400 });
    }

    const submissions = await prisma.submission.findMany({
      where: {
        problemId: { in: problemIds },
      },
      orderBy: {
        submittedAt: 'desc',
      },
      select: {
        id: true,
        studentId: true,
        courseId: true,
        assignmentId: true,
        problemId: true,
        correct: true,
        feedback: true,
        student: {
          select: {
            email: true,
            firstName: true,
            lastName: true,
            avatar: true,
          },
        },
        course: {
          select: { name: true },
        },
        assignmentProblem: {
          select: {
            assignment: {
              select: { title: true },
            },
            problem: {
              select: { title: true },
            },
            maxPoints: true,
          },
        },
        submittedAt: true,
        status: true,
        fileName: true,
        originalFileName: true,
      },
    });

    const gradeMap = new Map(
      (
        await prisma.assignmentProblemGrade.findMany({
          where: {
            studentId: { in: submissions.map((submission) => submission.studentId) },
            assignmentId: { in: submissions.map((submission) => submission.assignmentId) },
            problemId: { in: submissions.map((submission) => submission.problemId) },
          },
          select: {
            studentId: true,
            assignmentId: true,
            problemId: true,
            grade: true,
          },
        })
      ).map((row) => [`${row.studentId}:${row.assignmentId}:${row.problemId}`, row.grade] as const),
    );

    const formattedSubmissions = submissions.map((submission) => ({
      id: submission.id,
      studentId: submission.studentId,
      courseId: submission.courseId,
      assignmentId: submission.assignmentId,
      problemId: submission.problemId,
      studentFirstName: submission.student.firstName,
      studentLastName: submission.student.lastName,
      studentEmail: submission.student.email,
      courseName: submission.course.name,
      assignmentTitle: submission.assignmentProblem.assignment.title,
      problemTitle: submission.assignmentProblem.problem.title,
      submittedAt: submission.submittedAt.toISOString(),
      status: submission.status,
      correct: submission.correct,
      feedback: submission.feedback,
      grade: gradeMap.get(`${submission.studentId}:${submission.assignmentId}:${submission.problemId}`) ?? null,
      maxPoints: submission.assignmentProblem.maxPoints,
      avatar: submission.student.avatar,
      fileName: submission.fileName,
      originalFileName: submission.originalFileName,
    }));

    return NextResponse.json(formattedSubmissions);
  } catch (error) {
    console.error('Error fetching submissions:', error);
    await createEnhancedActivityLog(prisma, req, {
      userId: null,
      action: 'ADMIN_SUBMISSIONS_ERROR',
      severity: 'ERROR',
      metadata: { error: error instanceof Error ? error.message : 'unknown error' },
    });
    return NextResponse.json(
      { error: 'Failed to fetch submissions' },
      { status: 500 }
    );
  }
}
