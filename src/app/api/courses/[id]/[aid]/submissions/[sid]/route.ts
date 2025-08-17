// /src/api/courses/[id]/[aid]/submissions/[sid]/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string; aid: string; sid: string }> },
) {
  const { id: courseId, aid: assignmentId, sid: studentId } = await context.params;

  try {
    // Get session and ensure user is authenticated
    const session = await auth();
    const user = session?.user;

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Verify that the assignment belongs to the given course
    const assignment = await prisma.assignment.findFirst({
      where: { id: assignmentId, courseId },
      select: { id: true },
    });

    if (!assignment) {
      return NextResponse.json({ error: 'Assignment not found for this course' }, { status: 404 });
    }

    // Get all problems linked to the assignment
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
            originalFileName: true,
          },
        },
      },
    });

    if (assignmentProblems.length === 0) {
      return NextResponse.json({ error: 'No problems linked to this assignment' }, { status: 404 });
    }

    // Fetch all submissions for the student for this assignment
    const submissions = await prisma.submission.findMany({
      where: {
        assignmentId,
        studentId,
      },
      orderBy: { submittedAt: 'desc' },
      select: {
        id: true,
        submittedAt: true,
        grade: true,
        feedback: true,
        correct: true,
        fileName: true,
        originalFileName: true,
        problemId: true,
      },
    });

    // Group submissions by problemId and attach related problem metadata
    const result: Record<
      string,
      {
        problem: {
          id: string;
          title: string;
          description: string | null;
          type: string | null;
          maxStates: number | null;
          isDeterministic: boolean | null;
          originalFileName: string | null;
        };
        submissions: {
          id: string;
          submittedAt: Date;
          grade: number | null;
          feedback: string | null;
          correct: boolean | null;
          fileName: string | null;
          originalFileName: string | null;
        }[];
      }
    > = {};

    for (const { problem } of assignmentProblems) {
      const subsForProblem = submissions.filter((s) => s.problemId === problem.id);
      result[problem.id] = {
        problem,
        submissions: subsForProblem.map((s) => ({
          id: s.id,
          submittedAt: s.submittedAt,
          grade: s.grade,
          feedback: s.feedback,
          correct: s.correct,
          fileName: s.fileName,
          originalFileName: s.originalFileName,
        })),
      };
    }

    // Log access to assignment submissions
    const ip =
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      req.headers.get('x-real-ip') ||
      'unknown';
    const userAgent = req.headers.get('user-agent') || 'unknown';

    await prisma.activityLog.create({
      data: {
        userId: user.id,
        action: 'VIEW_ASSIGNMENT_SUBMISSIONS',
        metadata: {
          courseId,
          assignmentId,
          viewedStudentId: studentId,
          ipAddress: ip,
          userAgent,
        },
      },
    });

    // Return structured submission data grouped by problem
    return NextResponse.json(result);
  } catch (err) {
    // Catch unexpected errors
    console.error('Error fetching submissions:', err);
    return NextResponse.json({ error: 'Failed to fetch submissions' }, { status: 500 });
  }
}
