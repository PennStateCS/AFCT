// /src/api/courses/[id]/[aid]/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ProblemTypeEnum } from '@/schemas/problem';
import { RoleEnum } from '@/schemas/user';
import { z } from 'zod';

// Types
interface AssignmentWithProblemsAndCourse {
  problems: {
    problem: {
      id: string;
      title: string;
      description: string | null;
      type: z.infer<typeof ProblemTypeEnum> | null;
      maxStates: number | null;
      isDeterministic: boolean | null;
      fileName: string | null;
      originalFileName: string | null;
    };
    maxPoints: number;
    maxSubmissions: number;
    autograderEnabled: boolean;
  }[];

  course: {
    name: string;
    code: string;
    isArchived: boolean;
    roster: {
      role: z.infer<typeof RoleEnum> | null;
      user: {
        id: string;
        firstName: string;
        lastName: string;
      }
    }[]
  }
}

// GET: Fetch a specific assignment and related data within a course
export async function GET(_: Request, context: { params: Promise<{ id: string; aid: string }> }) {
  // Destructure courseId and assignmentId from the dynamic route parameters
  const { id: courseId, aid: assignmentId } = await context.params;

  try {
    // Query the assignment from the database
    const assignment = await prisma.assignment.findFirst({
      where: {
        id: assignmentId,
        courseId,
      },
      include: {
        problems: {
          select: {
            maxPoints: true,
            maxSubmissions: true,
            autograderEnabled: true,
            problem: {
              select: {
                id: true,
                title: true,
                description: true,
                type: true,
                maxStates: true,
                isDeterministic: true,
                fileName: true,
                originalFileName: true,
              },
            },
          },
        },
        course: {
          select: {
            name: true,
            code: true,
            isArchived: true,
            roster: {
              select: {
                role: true,
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
    }) as AssignmentWithProblemsAndCourse | null;

    // Return 404 if no matching assignment was found
    if (!assignment) {
      return NextResponse.json({ error: 'Assignment not found.' }, { status: 404 });
    }

    // Keep problems in the structure that the frontend expects
    const problemsWithRelation = assignment.problems.map((ap: (typeof assignment.problems)[number]) => ({
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
        maxPoints: ap.maxPoints,
        maxSubmissions: ap.maxSubmissions,
        autograderEnabled: ap.autograderEnabled,
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
        isArchived: course.isArchived,
        roster: roster.map((r: (typeof roster)[number]) => ({
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
