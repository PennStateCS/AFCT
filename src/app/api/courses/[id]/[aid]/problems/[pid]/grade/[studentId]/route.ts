import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET(
  _req: NextRequest,
  {
    params,
  }: {
    params: Promise<{ id: string; aid: string; pid: string; studentId: string }>;
  },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: courseId, aid: assignmentId, pid: problemId, studentId } = await params;

    const isStaff = ['ADMIN', 'FACULTY', 'TA'].includes(session.user.role);
    if (session.user.id !== studentId && !isStaff) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const assignmentProblem = await prisma.assignmentProblem.findUnique({
      where: {
        assignmentId_problemId: {
          assignmentId,
          problemId,
        },
      },
      select: {
        assignment: { select: { courseId: true } },
      },
    });

    if (!assignmentProblem || assignmentProblem.assignment.courseId !== courseId) {
      return NextResponse.json({ error: 'Problem not found' }, { status: 404 });
    }

    const grade = await prisma.assignmentProblemGrade.findUnique({
      where: {
        assignmentId_problemId_studentId: {
          assignmentId,
          problemId,
          studentId,
        },
      },
    });

    if (!grade) {
      return NextResponse.json({ grade: null, feedback: null });
    }

    return NextResponse.json({
      grade: grade.grade ?? null,
      feedback: grade.feedback ?? null,
      updatedAt: grade.updatedAt,
    });
  } catch (error) {
    console.error('GET /api/courses/[id]/[aid]/problems/[pid]/grade/[studentId] error:', error);
    return NextResponse.json({ error: 'Failed to fetch problem grade' }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  {
    params,
  }: {
    params: Promise<{ id: string; aid: string; pid: string; studentId: string }>;
  },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!['ADMIN', 'FACULTY', 'TA'].includes(session.user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { id: courseId, aid: assignmentId, pid: problemId, studentId } = await params;

    const assignmentProblem = await prisma.assignmentProblem.findUnique({
      where: {
        assignmentId_problemId: {
          assignmentId,
          problemId,
        },
      },
      select: {
        assignment: { select: { courseId: true } },
        maxPoints: true,
      },
    });

    if (!assignmentProblem || assignmentProblem.assignment.courseId !== courseId) {
      return NextResponse.json({ error: 'Problem not found' }, { status: 404 });
    }

    const body = await req.json();
    const grade = body?.grade as number | null | undefined;
    const feedback = typeof body?.feedback === 'string' ? body.feedback : null;

    if (grade !== null && grade !== undefined) {
      if (typeof grade !== 'number' || Number.isNaN(grade)) {
        return NextResponse.json({ error: 'Grade must be a number or null' }, { status: 400 });
      }
      if (grade < 0 || grade > assignmentProblem.maxPoints) {
        return NextResponse.json({ error: 'Grade out of range for this problem' }, { status: 400 });
      }
    }

    if (grade === null || grade === undefined) {
      await prisma.assignmentProblemGrade.deleteMany({
        where: {
          assignmentId,
          problemId,
          studentId,
        },
      });
      return NextResponse.json({ grade: null, feedback: null });
    }

    const saved = await prisma.assignmentProblemGrade.upsert({
      where: {
        assignmentId_problemId_studentId: {
          assignmentId,
          problemId,
          studentId,
        },
      },
      create: {
        assignmentId,
        problemId,
        studentId,
        grade,
        feedback,
      },
      update: {
        grade,
        feedback,
      },
    });

    return NextResponse.json({
      grade: saved.grade ?? null,
      feedback: saved.feedback ?? null,
      updatedAt: saved.updatedAt,
    });
  } catch (error) {
    console.error('POST /api/courses/[id]/[aid]/problems/[pid]/grade/[studentId] error:', error);
    return NextResponse.json({ error: 'Failed to save problem grade' }, { status: 500 });
  }
}
