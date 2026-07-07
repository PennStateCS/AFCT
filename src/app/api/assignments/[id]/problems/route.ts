// /src/app/api/assignments/[id]/problems/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { canManageCourse, COURSE_FACULTY_ROLES } from '@/lib/permissions';
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
  solved: boolean;
  grade: number | null; // grade from AssignmentProblemGrade
}

interface AssignmentProblemResult {
  problem: Problem;
  submissions: { id: string }[];
  AssignmentProblemGrade?: { grade: number | null } | null;
}

/**
 * Lists an assignment's problems, tagged with whether the caller has solved each
 * (a correct submission) and their grade. For group assignments, visibility follows
 * the caller's group — unassigned problems show to everyone, group-mapped ones only
 * to that group's members. Currently restricted to ADMIN/FACULTY.
 * @openapi
 * summary: List an assignment's problems
 * parameters:
 *   - { name: id, in: path, required: true, description: Assignment id, schema: { type: string } }
 * responses:
 *   200:
 *     description: The visible problems with solved/grade flags.
 *     content:
 *       application/json:
 *         schema: { type: array, items: { type: object } }
 *   400: { description: Missing assignment id. }
 *   401: { description: "Not signed in, or not an admin/faculty user." }
 *   404: { description: Assignment not found. }
 *   500: { description: Server error. }
 */
export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const params = await context.params;
  const assignmentId = params?.id;

  if (!assignmentId) {
    return NextResponse.json({ error: 'Missing course ID' }, { status: 400 });
  }

  const session = await auth();
  if (!session?.user) {
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

    // Faculty-tier staff only (INSTRUCTOR/FACULTY, TAs excluded) or admin.
    if (!(await canManageCourse(session.user, assignment.courseId, COURSE_FACULTY_ROLES))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // ---- User and Course Id ----
    const userId = session.user.id;
    const courseId = assignment.courseId;

    // ---- Load problems ----
    // If this is a group assignment, determine the user's group for the course
    const userGroupEntry = assignment.isGroup
      ? await prisma.groupRoster.findFirst({
          where: { courseId, userId },
          select: { groupId: true },
        })
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
      const mapped =
        (ap.problem as { groupAssignmentProblems?: { groupId: string }[] })
          .groupAssignmentProblems ?? [];
      if (!assignment.isGroup) return true; // assignment-level problems when not group-mode
      if (mapped.length === 0) return true; // unassigned -> visible to everyone
      if (!userGroupId) return false; // user has no group -> can't see group-only problems
      return mapped.some((m: { groupId: string }) => m.groupId === userGroupId);
    });

    const problems: ProblemWithSolved[] = visible.map((ap) => ({
      ...ap.problem,
      solved: ap.submissions.length > 0,
      grade:
        (ap as { AssignmentProblemGrade?: { grade?: number | null } }).AssignmentProblemGrade
          ?.grade ??
        (ap as { grades?: { grade?: number | null }[] }).grades?.[0]?.grade ??
        null,
    }));

    // ---- Activity log ----
    try {
      await createEnhancedActivityLog(prisma, req, {
        userId,
        action: 'VIEW_ASSIGNMENT_PROBLEMS',
        severity: 'INFO',
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
