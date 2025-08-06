// /src/app/api/assignments/[id]/problems

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/app/utils/jwt';

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id: assignmentId } = await context.params;

  try {
    // Extract the Bearer token from the Authorization header
    const authHeader = req.headers.get('authorization');
    const token = authHeader?.split(' ')[1];

    if (!token) {
      return NextResponse.json({ error: 'Missing token' }, { status: 401 });
    }

    // Attempt to decode and verify the token
    let decoded;
    try {
      decoded = verifyToken(token);
    } catch (err: any) {
      console.error('Invalid or expired token:', err);
      return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 });
    }

    // Fetch the assignment to get courseId
    const assignment = await prisma.assignment.findUnique({
      where: { id: assignmentId },
      select: { courseId: true },
    });

    if (!assignment) {
      return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
    }

    const userRole = decoded.role;
    const userId = decoded.id;
    const courseId = assignment.courseId;

    // Role-based access control
    if (userRole === 'STUDENT') {
      // Students must be enrolled in the course
      const enrollment = await prisma.studentCourses.findFirst({
        where: {
          courseId,
          studentId: userId,
        },
      });

      if (!enrollment) {
        return NextResponse.json({ error: 'You are not enrolled in this course' }, { status: 403 });
      }
    } else if (!['FACULTY', 'TA', 'ADMIN'].includes(userRole)) {
      // Deny access for other roles
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // Fetch all problems linked to the assignment
    const assignmentProblems = await prisma.assignmentProblem.findMany({
      where: { assignmentId },
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
      },
      orderBy: { problemId: 'asc' },
    });

    const problems = assignmentProblems.map((ap) => ap.problem);

    // Extract IP address for logging
    const ip =
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      req.headers.get('x-real-ip') ||
      'unknown';

    // Log the access to activity log
    await prisma.activityLog.create({
      data: {
        userId,
        action: 'VIEW_ASSIGNMENT_PROBLEMS',
        metadata: {
          assignmentId,
          courseId,
          ipAddress: ip,
        },
      },
    });

    return NextResponse.json(problems);
  } catch (error) {
    console.error('API GET PROBLEMS error:', error);
    return NextResponse.json({ error: 'Failed to fetch problems' }, { status: 500 });
  }
}
