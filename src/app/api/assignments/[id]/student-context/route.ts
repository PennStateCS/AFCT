import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id: assignmentId } = await params;
  const userId = session.user.id;

  try {
    const assignment = await prisma.assignment.findUnique({
      where: { id: assignmentId },
      select: {
        id: true,
        courseId: true,
        isPublished: true,
        problems: {
          select: {
            problemId: true,
          },
        },
      },
    });

    if (!assignment) {
      return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
    }

    if (!assignment.isPublished && session.user.role === 'STUDENT') {
      return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
    }

    const roster = await prisma.roster.findFirst({
      where: {
        courseId: assignment.courseId,
        userId,
      },
      select: {
        id: true,
      },
    });

    if (!roster) {
      return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
    }

    const problemIds = assignment.problems.map((problem) => problem.problemId);

    const [submissions, comments, grades] = await Promise.all([
      prisma.submission.findMany({
        where: {
          assignmentId,
          studentId: userId,
          problemId: { in: problemIds },
        },
        orderBy: { submittedAt: 'desc' },
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
      }),
      prisma.comment.findMany({
        where: {
          assignmentId,
          problemId: { in: problemIds },
          OR: [{ aboutStudentId: userId }, { roster: { userId } }],
        },
        include: {
          roster: {
            include: {
              user: {
                select: {
                  firstName: true,
                  lastName: true,
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.assignmentProblemGrade.findMany({
        where: {
          assignmentId,
          studentId: userId,
          problemId: { in: problemIds },
        },
        select: {
          problemId: true,
          grade: true,
        },
      }),
    ]);

    const submissionsByProblem: Record<string, (typeof submissions)[number][]> = {};
    for (const problemId of problemIds) {
      submissionsByProblem[problemId] = [];
    }

    for (const submission of submissions) {
      if (!submissionsByProblem[submission.problemId]) {
        submissionsByProblem[submission.problemId] = [];
      }
      submissionsByProblem[submission.problemId].push(submission);
    }

    const commentsByProblem: Record<string, (typeof comments)[number][]> = {};
    for (const problemId of problemIds) {
      commentsByProblem[problemId] = [];
    }

    for (const comment of comments) {
      if (!commentsByProblem[comment.problemId]) {
        commentsByProblem[comment.problemId] = [];
      }
      commentsByProblem[comment.problemId].push(comment);
    }

    const gradeMap = new Map(grades.map((grade) => [grade.problemId, grade.grade]));
    const problemGrades = Object.fromEntries(
      problemIds.map((problemId) => [problemId, gradeMap.get(problemId) ?? null]),
    );
    const gradesList = Object.values(problemGrades);
    const hasAnyGrade = gradesList.some((grade) => grade !== null);
    const assignmentGrade = hasAnyGrade
      ? gradesList.reduce((sum: number, grade) => sum + (grade ?? 0), 0)
      : null;

    return NextResponse.json({
      assignmentGrade,
      problemGrades,
      submissionCount: submissions.length,
      submissionsByProblem: Object.fromEntries(
        Object.entries(submissionsByProblem).map(([problemId, problemSubmissions]) => [
          problemId,
          problemSubmissions.map((submission) => ({
            id: submission.id,
            submittedAt: submission.submittedAt.toISOString(),
            grade: gradeMap.get(submission.problemId) ?? null,
            feedback: submission.feedback,
            correct: submission.correct,
            fileName: submission.fileName,
            originalFileName: submission.originalFileName,
            problemId: submission.problemId,
            status: submission.status,
          })),
        ]),
      ),
      commentsByProblem: Object.fromEntries(
        Object.entries(commentsByProblem).map(([problemId, problemComments]) => [
          problemId,
          problemComments.map((comment) => ({
            id: comment.id,
            content: comment.content,
            createdAt: comment.createdAt.toISOString(),
            authorId: comment.roster?.userId ?? null,
            authorName: [comment.roster?.user?.firstName, comment.roster?.user?.lastName].filter(Boolean).join(' ') || 'Unknown',
            authorRole: comment.roster?.role ?? 'STUDENT',
            problemId: comment.problemId,
          })),
        ]),
      ),
    });
  } catch (error) {
    console.error('GET student-context error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
