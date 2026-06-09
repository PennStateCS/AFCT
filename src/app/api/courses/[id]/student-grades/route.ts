import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: courseId } = await params;
    if (!courseId) {
      return NextResponse.json({ error: 'Missing course ID' }, { status: 400 });
    }

    const member = await prisma.roster.findUnique({
      where: { courseId_userId: { courseId, userId: session.user.id } },
      select: { id: true },
    });

    const isStaff = ['ADMIN', 'FACULTY', 'TA'].includes(session.user.role);
    if (!member && !isStaff) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const assignments = await prisma.assignment.findMany({
      where: { courseId, isPublished: true },
      select: {
        id: true,
        title: true,
        description: true,
        dueDate: true,
      },
      orderBy: { dueDate: 'asc' },
    });

    const assignmentIds = assignments.map((assignment) => assignment.id);

    const problems = await prisma.assignmentProblem.findMany({
      where: { assignmentId: { in: assignmentIds } },
      select: {
        assignmentId: true,
        maxPoints: true,
        maxSubmissions: true,
        problem: {
          select: {
            id: true,
            title: true,
          },
        },
      },
      orderBy: { assignmentId: 'asc' },
    });

    const grades = await prisma.assignmentProblemGrade.findMany({
      where: {
        assignmentId: { in: assignmentIds },
        studentId: session.user.id,
      },
      select: {
        assignmentId: true,
        problemId: true,
        grade: true,
      },
    });

    const submissionCounts = await prisma.submission.groupBy({
      by: ['assignmentId', 'problemId'],
      where: {
        assignmentId: { in: assignmentIds },
        studentId: session.user.id,
      },
      _count: {
        id: true,
      },
    });

    // Get most recent status
    const latestSubmissions = await prisma.submission.findMany({
      where: {
        assignmentId: { in: assignmentIds },
        studentId: session.user.id,
      },
      distinct: ['assignmentId', 'problemId'],
      orderBy: {
        createdAt: 'desc',
      },
      select: {
        assignmentId: true,
        problemId: true,
        status: true,
      },
    })

    const gradeMap = new Map<string, number | null>();
    grades.forEach((grade) => {
      gradeMap.set(`${grade.assignmentId}:${grade.problemId}`, grade.grade ?? null);
    });

    const submissionCountMap = new Map<string, number>();
    submissionCounts.forEach((item) => {
      submissionCountMap.set(`${item.assignmentId}:${item.problemId}`, item._count.id);
    });

    const submissionStatusMap = new Map<string, string>();
    latestSubmissions.forEach((item) => {
      submissionStatusMap.set(`${item.assignmentId}:${item.problemId}`, item.status);
    });

    const groupedProblems = problems.reduce<Record<string, Array<{
      id: string;
      title: string | null;
      maxPoints: number;
      maxSubmissions: number;
    }>>>((acc, problem) => {
      if (!acc[problem.assignmentId]) acc[problem.assignmentId] = [];
      acc[problem.assignmentId].push({
        id: problem.problem.id,
        title: problem.problem.title,
        maxPoints: Number(problem.maxPoints ?? 0),
        maxSubmissions: Number(problem.maxSubmissions ?? 0),
      });
      return acc;
    }, {});

    const payload = assignments.map((assignment) => {
      const assignmentProblems = groupedProblems[assignment.id] ?? [];
      const problemDetails = assignmentProblems.map((problem) => ({
        id: problem.id,
        title: problem.title,
        maxPoints: problem.maxPoints,
        maxSubmissions: problem.maxSubmissions,
        status: submissionStatusMap.get(`${assignment.id}:${problem.id}`) ?? "",
        submissionCount: submissionCountMap.get(`${assignment.id}:${problem.id}`) ?? 0,
        grade: gradeMap.get(`${assignment.id}:${problem.id}`) ?? null,
      }));
      const maxPoints = problemDetails.reduce((sum, problem) => sum + problem.maxPoints, 0);
      const assignmentGrade = problemDetails.reduce((sum, problem) => sum + (problem.grade ?? 0), 0);
      const hasGrade = problemDetails.some((problem) => problem.grade !== null);

      return {
        id: assignment.id,
        title: assignment.title,
        description: assignment.description,
        dueDate: assignment.dueDate?.toISOString() ?? null,
        maxPoints,
        grade: hasGrade ? assignmentGrade : null,
        problems: problemDetails,
      };
    });

    return NextResponse.json({ assignments: payload });
  } catch (error) {
    console.error('GET /api/courses/[id]/student-grades error:', error);
    const detail = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      {
        error: 'Failed to fetch student grades',
        detail: process.env.NODE_ENV === 'development' ? detail : undefined,
      },
      { status: 500 },
    );
  }
}
