import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
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
    roster?: {
      role: z.infer<typeof RoleEnum> | null;
      user: {
        id: string;
        firstName: string;
        lastName: string;
      };
    }[];
  };
}

/**
 * Fetches one assignment (scoped to the course) with its problems, a derived
 * `maxPoints`, and — in the `full` view — the course roster. Shaped for the
 * assignment detail page. Access is restricted: staff (ADMIN/FACULTY/TA) may view
 * any assignment; everyone else must be enrolled in the course.
 * @openapi
 * summary: Get a course assignment
 * description: >-
 *   Returns the assignment with its problems and, in the full view, the course
 *   roster. Requires a session; non-staff callers must be enrolled in the course.
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 *   - { name: aid, in: path, required: true, schema: { type: string } }
 *   - name: view
 *     in: query
 *     description: '"full" (default) includes the roster; any other value omits it.'
 *     schema: { type: string, default: full }
 * responses:
 *   200: { description: The assignment with problems (and roster in full view). }
 *   401: { description: Not signed in. }
 *   403: { description: Not staff and not enrolled in the course. }
 *   404: { description: Assignment not found in this course. }
 *   500: { description: Server error. }
 */
export async function GET(req: Request, context: { params: Promise<{ id: string; aid: string }> }) {
  const { id: courseId, aid: assignmentId } = await context.params;
  const { searchParams } = new URL(req.url);
  const view = searchParams.get('view') ?? 'full';
  const includeRoster = view === 'full';

  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    // Access: staff may view any assignment; everyone else must be enrolled.
    const isStaff = ['ADMIN', 'FACULTY', 'TA'].includes(session.user.role);
    if (!isStaff) {
      const enrolled = await prisma.roster.findFirst({
        where: { courseId, userId: session.user.id },
        select: { id: true },
      });
      if (!enrolled) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    const assignment = (await prisma.assignment.findFirst({
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
            ...(includeRoster
              ? {
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
                }
              : {}),
          },
        },
      },
    })) as AssignmentWithProblemsAndCourse | null;

    // Return 404 if no matching assignment was found
    if (!assignment) {
      return NextResponse.json({ error: 'Assignment not found.' }, { status: 404 });
    }

    // Keep problems in the structure that the frontend expects
    const problemsWithRelation = assignment.problems.map(
      (ap: (typeof assignment.problems)[number]) => ({
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
      }),
    );

    const totalProblemPoints = assignment.problems.reduce((sum, ap) => {
      const value = typeof ap.maxPoints === 'number' ? ap.maxPoints : 0;
      return sum + (Number.isFinite(value) ? value : 0);
    }, 0);

    // Extract the course roster and keep in the structure that the frontend expects
    const roster = assignment.course.roster || [];

    // Remove joined fields to avoid duplication in the response
    const { problems: _problems, course, ...assignmentData } = assignment;

    // Return structured assignment matching the frontend's expected format
    return NextResponse.json({
      ...assignmentData,
      maxPoints: totalProblemPoints,
      problems: problemsWithRelation,
      course: {
        id: courseId,
        name: course.name,
        code: course.code,
        isArchived: course.isArchived,
        ...(includeRoster
          ? {
              roster: roster.map((r: (typeof roster)[number]) => ({
                user: r.user,
                role: r.role,
              })),
            }
          : {}),
      },
    });
  } catch (error) {
    // Handle unexpected errors
    console.error('Failed to fetch assignment:', error);
    return NextResponse.json({ error: 'Failed to fetch assignment.' }, { status: 500 });
  }
}
