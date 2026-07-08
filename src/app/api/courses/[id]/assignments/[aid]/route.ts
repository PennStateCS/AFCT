import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ProblemTypeEnum } from '@/schemas/problem';
import { RoleEnum } from '@/schemas/user';
import { withCourseAuth } from '@/lib/api/with-auth';
import { canManageCourse } from '@/lib/permissions';
import { sumProblemPoints } from '@/lib/course-format';
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
 * Fetches one assignment (scoped to the course) with its problems and a derived
 * `maxPoints`. This is the single canonical assignment read (it absorbed the former
 * global `GET /api/assignments/[id]`). Access: the caller must be an enrolled member
 * of the course or a system admin. Course staff (faculty/TA) and admins see any
 * assignment and — in the `full` view — the course roster; non-staff members see only
 * published assignments (unpublished are 404-masked) and never receive the roster.
 * @openapi
 * summary: Get a course assignment
 * description: >-
 *   Returns the assignment with its problems. Staff/admins also get the course roster
 *   in the full view; non-staff members see published assignments only (unpublished
 *   are masked as 404) and no roster.
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 *   - { name: aid, in: path, required: true, schema: { type: string } }
 *   - name: view
 *     in: query
 *     description: '"full" (default) includes the roster for staff; any other value omits it.'
 *     schema: { type: string, default: full }
 * responses:
 *   200: { description: "The assignment with problems (and, for staff in full view, the roster)." }
 *   401: { description: Not signed in. }
 *   403: { description: Not an enrolled member of the course and not a system admin. }
 *   404: { description: "Assignment not found in this course, or not visible to the caller." }
 *   500: { description: Server error. }
 */
export const GET = withCourseAuth(
  async (req, ctx, { user, courseId }) => {
    const { aid: assignmentId } = await ctx.params;
    const { searchParams } = new URL(req.url);
    const view = searchParams.get('view') ?? 'full';
    // Course staff (faculty/TA) or admins see everything; the roster is staff-only
    // and unpublished assignments are hidden from non-staff members (404-masked),
    // matching the access rules of the retired global GET /api/assignments/[id].
    const isStaff = await canManageCourse(user, courseId);
    const includeRoster = view === 'full' && isStaff;

    try {
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

      // Non-staff members may only see published assignments; hide the rest as 404.
      if (!isStaff && !(assignment as { isPublished?: boolean }).isPublished) {
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

      const totalProblemPoints = sumProblemPoints(assignment.problems);

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
  },
  { access: 'read', deniedAction: 'ASSIGNMENT_VIEW_DENIED' },
);
