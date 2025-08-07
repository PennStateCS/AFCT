// /src/api/courses/[id]/[aid]/add-problems/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';

// POST: Replace problems for a given assignment in a specific course
export async function POST(req: Request, { params }: { params: { id: string; aid: string } }) {
  const { id: courseId, aid: assignmentId } = params;

  try {
    // Get session and validate user role
    const session = await getServerSession(authOptions);
    const user = session?.user;

    if (!user || !['ADMIN', 'FACULTY', 'TA'].includes(user.role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // Parse the request body
    const body = await req.json();
    const problemIds: string[] = Array.isArray(body.problemIds) ? body.problemIds : [];

    // Validate that all problems exist and belong to the specified course
    const validProblems = await prisma.problem.findMany({
      where: {
        id: { in: problemIds },
        courseId,
      },
      select: { id: true },
    });

    const validIds = validProblems.map((p) => p.id);

    // Remove any existing problem links for this assignment (only for this course)
    await prisma.assignmentProblem.deleteMany({
      where: {
        assignmentId,
        assignment: {
          courseId,
        },
      },
    });

    // Add new links for valid problems
    if (validIds.length > 0) {
      await prisma.assignmentProblem.createMany({
        data: validIds.map((pid) => ({
          assignmentId,
          problemId: pid,
        })),
      });
    }

    // Fetch the updated assignment with its problems
    const updated = await prisma.assignment.findUnique({
      where: { id: assignmentId },
      include: {
        problems: {
          include: { problem: true },
        },
      },
    });

    const problems = updated?.problems.map((ap) => ap.problem) || [];

    // Log the action to the ActivityLog
    const ip =
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      req.headers.get('x-real-ip') ||
      'unknown';
    const userAgent = req.headers.get('user-agent') || 'unknown';

    await prisma.activityLog.create({
      data: {
        userId: user.id,
        action: 'UPDATE_ASSIGNMENT_PROBLEMS',
        metadata: {
          courseId,
          assignmentId,
          addedProblemIds: validIds,
          ipAddress: ip,
          userAgent: userAgent,
        },
      },
    });

    // Respond with the updated problem list
    return NextResponse.json({ success: true, problems });
  } catch (err) {
    // Handle unexpected errors
    console.error('Failed to update assignment problems:', err);
    return NextResponse.json({ error: 'Failed to update assignment problems.' }, { status: 500 });
  }
}
