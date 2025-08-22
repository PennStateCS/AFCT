// /src/api/courses/[id]/[aid]/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// GET: Fetch a specific assignment and related data within a course
export async function GET(_: Request, context: { params: Promise<{ id: string; aid: string }> }) {
  // Destructure courseId and assignmentId from the dynamic route parameters
  const { id: courseId, aid: assignmentId } = await context.params;

  try {
    // Query the assignment from the database
    const assignment = await prisma.assignment.findFirst({
      where: {
        id: assignmentId,
        courseId, // Ensure the assignment belongs to the specified course
      },
      include: {
        problems: {
          include: {
            problem: true, // Join AssignmentProblem → Problem
          },
        },
        course: {
          include: {
            roster: {
              include: {
                user: {
                  select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    // Return 404 if no matching assignment was found
    if (!assignment) {
      return NextResponse.json({ error: 'Assignment not found.' }, { status: 404 });
    }

    // Keep problems in the structure that the frontend expects
    const problemsWithRelation = assignment.problems.map((ap) => ({
      problem: {
        id: ap.problem.id,
        title: ap.problem.title,
        description: ap.problem.description,
        type: ap.problem.type,
        maxStates: ap.problem.maxStates,
        isDeterministic: ap.problem.isDeterministic,
  fileName: ap.problem.fileName,
  originalFileName: ap.problem.originalFileName,
      },
    }));

    // Extract the course roster and keep in the structure that the frontend expects
    const roster = assignment.course.roster || [];

    // Remove joined fields to avoid duplication in the response
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { problems: _problems, course, ...assignmentData } = assignment;

    // Return structured assignment matching the frontend's expected format
    return NextResponse.json({
      ...assignmentData,
      problems: problemsWithRelation,
      course: {
        id: courseId,
        name: course.name,
        code: course.code,
        roster: roster.map((r) => ({
          user: r.user,
          role: r.role,
        })),
      },
    });
  } catch (error) {
    // Handle unexpected errors
    console.error('Failed to fetch assignment:', error);
    return NextResponse.json({ error: 'Failed to fetch assignment.' }, { status: 500 });
  }
}
