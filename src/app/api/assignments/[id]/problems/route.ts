// /src/app/api/assignments/[id]/problems/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, JwtPayload } from '@/app/utils/jwt';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { ProblemTypeEnum } from '@/schemas/problem';
import { z } from 'zod';

// Types
interface Problem {
  id: string;
  title: string;
  description: string | null;
  type: z.infer<typeof ProblemTypeEnum> | null;
  maxStates: number | null;
  isDeterministic: boolean | null;
  groupAssignmentProblems?: { groupId: string }[];
}

interface ProblemWithSolved extends Problem {
  submissionCount: number;
  grade: number | null; // grade from AssignmentProblemGrade
}

interface AssignmentProblemResult {
  problem: Problem;
  submissions: { id: string }[];
  AssignmentProblemGrade?: { grade: number | null } | null;
}

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  // Await params if it is a Promise (some environments do this)
  const params = await context.params;
  const assignmentId = params?.id;

  // 1. Validate courseId
  if (!assignmentId) {
    return NextResponse.json({ error: 'Missing course ID' }, { status: 400 });
  }

  // 2. Extract and verify token
  const authHeader = req.headers.get('authorization');
  const token = authHeader?.split(' ')[1];
  const decoded: JwtPayload | null = token ? verifyToken(token) : null;

  if (!decoded) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // ---- Assignment lookup ----
    const assignment = await prisma.assignment.findUnique({
      where: { id: assignmentId },
      select: { courseId: true, isGroup: true },
    });

    if (!assignment) {
      return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
    }

    // ---- UserId from token ----
    const userId = decoded.userId;

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
    // If this is a group assignment, determine the user's group for the course
    const userGroupEntry = assignment.isGroup
      ? await prisma.groupRoster.findFirst({ where: { courseId, userId }, select: { groupId: true } })
      : null;
    const userGroupId = userGroupEntry?.groupId ?? null;

    const submissionsWhere = userGroupId
      ? { correct: true, OR: [{ studentId: userId }, { groupId: userGroupId }] }
      : { studentId: userId, correct: true };

    const assignmentProblems = (await prisma.assignmentProblem.findMany({
      where: { assignmentId: assignmentId },
      include: {
        problem: {
          select: {
            id: true,
            title: true,
            description: true,
            type: true,
            maxPoints: true,
            maxSubmissions: true,
            maxStates: true,
            isDeterministic: true,
            // Pull any group->problem mappings so we can determine visibility
            groupAssignmentProblems: { select: { groupId: true } },
          },
        },
        submissions: {
          where: submissionsWhere,
          select: { id: true },
        },
      },
      orderBy: {
        problemId: 'asc',
      },
    })) as AssignmentProblemResult[];

    // For group assignments: include problems that are unassigned (apply to everyone)
    // or explicitly mapped to the user's group. For non-group assignments return all.
    const visible = assignmentProblems.filter((ap) => {
      const mapped = (ap.problem as any).groupAssignmentProblems ?? [];
      if (!assignment.isGroup) return true; // assignment-level problems when not group-mode
      if (mapped.length === 0) return true; // unassigned -> visible to everyone
      if (!userGroupId) return false; // user has no group -> can't see group-only problems
      return mapped.some((m: { groupId: string }) => m.groupId === userGroupId);
    });

    const problems: ProblemWithSolved[] = visible.map((ap) => ({
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
