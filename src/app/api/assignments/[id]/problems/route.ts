// /src/app/api/assignments/[id]/problems/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, JwtPayload } from '@/app/utils/jwt';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  // Await params if it is a Promise (some environments do this)
  const params = await context.params;
  const assignmentId = params?.id;

  try {
    // ---- Auth header / token ----
    const authHeader = req.headers.get('authorization');
    const token = authHeader?.split(' ')[1];

    if (!token) {
      return NextResponse.json({ error: 'Missing token' }, { status: 401 });
    }

    // ---- Verify token ----
    let decoded: JwtPayload | null;
    try {
      decoded = verifyToken(token);
    } catch {
      return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 });
    }

    // ---- Assignment lookup ----
    const assignment = await prisma.assignment.findUnique({
      where: { id: assignmentId },
      select: { courseId: true },
    });

    if (!assignment) {
      return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
    }

    // ---- UserId from token ----
    const userId = decoded?.userId;
    if (!userId) {
      return NextResponse.json({ error: 'Invalid token payload' }, { status: 401 });
    }

    // ---- Enrollment check (any role) ----
    const courseId = assignment.courseId;
    const enrollment = await prisma.roster.findFirst({
      where: { courseId, userId },
      select: { id: true },
    });

    if (!enrollment) {
      return NextResponse.json({ error: 'You are not enrolled in this course' }, { status: 403 });
    }

    // ---- Load problems ----
    const assignmentProblems = await prisma.assignmentProblem.findMany({
      where: { assignmentId: assignmentId },
      include: {
        problem: {
          select: {
            id: true,
            title: true,
            description: true,
            type: true,
            maxStates: true,
            isDeterministic: true,
          },
        },
        submissions: {
          where: {
            studentId: userId,
            correct: true,
          },
          select: { id: true },
        },
      },
      orderBy: {
        problemId: 'asc'
      },
    });

    const problems = assignmentProblems.map((ap) => ({
      ...ap.problem,
      solved: ap.submissions.length > 0,
    }));

    // ---- Activity log ----
    try {
      await createEnhancedActivityLog(prisma, req, {
        userId,
        action: 'VIEW_ASSIGNMENT_PROBLEMS',
        category: 'ASSIGNMENT',
        assignmentId,
        courseId,
        metadata: {
          userId: userId,
          assignmentId: assignmentId,
          courseId: courseId,
        },
      });
    } catch (logErr) {
      console.error('[problems] activityLog.create failed:', logErr);
      // do not fail the route on log issues
    }

    return NextResponse.json(problems);
  } catch (error) {
    console.error('API GET PROBLEMS error:', error);
    return NextResponse.json({ error: 'Failed to fetch problems' }, { status: 500 });
  }
}
