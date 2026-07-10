import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { ProblemTypeEnum } from '@/schemas/problem';
import { withCourseAuth } from '@/lib/api/with-auth';
import { z } from 'zod';

// Types
interface Id {
  id: string;
}

interface AssignmentProblemCount {
  _count: {
    submissions: number;
  };
  assignmentId: string;
  problemId: string;
}

interface AssignmentWithProblems {
  problems: {
    problem: {
      id: string;
      title: string;
      description: string | null;
      type: z.infer<typeof ProblemTypeEnum> | null;
      maxStates: number | null;
      isDeterministic: boolean | null;
    };
  }[];
}

const ProblemSettingsSchema = z.object({
  problemId: z.string(),
  maxPoints: z.number().min(0),
  maxSubmissions: z
    .number()
    .int()
    .refine((value) => value === -1 || value >= 1, {
      message: 'Max submissions must be -1 (unlimited) or at least 1.',
    }),
  autograderEnabled: z.boolean(),
});

type ProblemSettingsInput = z.infer<typeof ProblemSettingsSchema>;

/**
 * Attaches problems to an assignment with per-problem settings (points, submission
 * cap, autograder). Course staff (faculty or TAs) or a system admin. Adds only problems not already
 * linked — existing links, especially those with submissions, are preserved and
 * reported back. For group assignments, an optional `groupId` (or "ALL") maps the
 * given problems to specific groups, even ones already on the assignment. Only
 * problems belonging to this course are accepted.
 * @openapi
 * summary: Add problems to an assignment
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 *   - { name: aid, in: path, required: true, schema: { type: string } }
 * requestBody:
 *   required: true
 *   content:
 *     application/json:
 *       schema:
 *         type: object
 *         properties:
 *           problemIds: { type: array, items: { type: string } }
 *           problemSettings:
 *             type: array
 *             items:
 *               type: object
 *               required: [problemId, maxPoints, maxSubmissions, autograderEnabled]
 *               properties:
 *                 problemId: { type: string }
 *                 maxPoints: { type: number, minimum: 0 }
 *                 maxSubmissions: { type: integer, description: "-1 for unlimited, else >= 1" }
 *                 autograderEnabled: { type: boolean }
 *           groupId: { type: string, description: A group id or "ALL" (group assignments only) }
 * responses:
 *   200: { description: The assignment's problem list plus a summary of what changed. }
 *   400: { description: Empty/invalid body or invalid problemSettings. }
 *   401: { description: Not signed in. }
 *   403: { description: Caller is not course staff (faculty or TA) or a system admin. }
 *   500: { description: Server error. }
 */
export const POST = withCourseAuth(
  async (req, ctx, { user, courseId }) => {
    const { aid: assignmentId } = await ctx.params;

    try {
      // Parse the request body with better error handling
      let body;
      try {
        const requestText = await req.text();
        if (!requestText || requestText.trim() === '') {
          return NextResponse.json({ error: 'Empty request body' }, { status: 400 });
        }
        body = JSON.parse(requestText);
      } catch (parseError) {
        console.error('JSON parse error:', parseError);
        return NextResponse.json({ error: 'Invalid JSON in request body' }, { status: 400 });
      }

      const problemIds: string[] = Array.isArray(body.problemIds) ? body.problemIds : [];
      const parsedSettings = z.array(ProblemSettingsSchema).safeParse(body.problemSettings ?? []);
      if (!parsedSettings.success) {
        return NextResponse.json(
          { error: 'Invalid problemSettings in request body' },
          { status: 400 },
        );
      }
      const settingsByProblemId = new Map<string, ProblemSettingsInput>(
        parsedSettings.data.map((setting) => [setting.problemId, setting]),
      );
      // Optional group assignment: either a specific group id or 'ALL' for all groups
      const groupId: string | undefined =
        typeof body.groupId === 'string' ? body.groupId : undefined;

      // Only accept problems that actually belong to this course, and load the
      // existing assignment-problem links. Independent reads → run concurrently.
      const [validProblems, existingLinks] = (await Promise.all([
        prisma.problem.findMany({
          where: {
            id: { in: problemIds },
            courseId,
          },
          select: { id: true },
        }),
        prisma.assignmentProblem.findMany({
          where: {
            assignmentId,
            assignment: {
              courseId,
            },
          },
          include: {
            _count: {
              select: {
                submissions: true,
              },
            },
          },
        }),
      ])) as [Id[], AssignmentProblemCount[]];

      const validIds = validProblems.map((p: (typeof validProblems)[number]) => p.id);

      // Separate links with submissions (for reporting only)
      const linksWithSubmissions = existingLinks.filter(
        (link: (typeof existingLinks)[number]) => link._count.submissions > 0,
      );
      const existingProblemIds = existingLinks.map(
        (link: (typeof existingLinks)[number]) => link.problemId,
      );

      // Add new links for problems that aren't already linked
      const newProblemIds = validIds.filter(
        (pid: string) => !existingProblemIds.includes(pid),
      ) as string[];

      if (newProblemIds.length > 0) {
        await prisma.assignmentProblem.createMany({
          data: newProblemIds.map((pid: string) => {
            const config = settingsByProblemId.get(pid);
            const resolvedMaxSubmissions =
              config?.maxSubmissions === -1 ? -1 : Math.max(1, config?.maxSubmissions ?? 1);

            return {
              assignmentId,
              problemId: pid,
              maxPoints: config?.maxPoints ?? 0,
              maxSubmissions: resolvedMaxSubmissions,
              autograderEnabled: config?.autograderEnabled ?? true,
            };
          }),
        });
      }

      // If a group mapping was requested and the assignment supports group assignments,
      // create group mappings for the requested problems **regardless** of whether the
      // problems were newly added in this request. This enables assigning an existing
      // assignment problem to one or more groups after it already exists on the assignment.
      if (groupId) {
        // Fetch the assignment to inspect isGroup and course
        const updatedAssignment = await prisma.assignment.findUnique({
          where: { id: assignmentId },
        });

        if (updatedAssignment?.isGroup) {
          let groupIdsToMap: string[] = [];
          if (groupId === 'ALL') {
            const groups = await prisma.group.findMany({ where: { courseId } });
            groupIdsToMap = groups.map((g) => g.id);
          } else {
            // Validate the group exists and belongs to the course
            const group = await prisma.group.findUnique({ where: { id: groupId } });
            if (group && group.courseId === courseId) groupIdsToMap = [groupId];
          }

          if (groupIdsToMap.length > 0 && validIds.length > 0) {
            const mappings = [] as { assignmentId: string; problemId: string; groupId: string }[];
            // Map all validIds (this covers both newly added and already-present assignment problems)
            for (const pid of validIds) {
              for (const gid of groupIdsToMap) {
                mappings.push({ assignmentId, problemId: pid, groupId: gid });
              }
            }
            if (mappings.length > 0) {
              await prisma.groupAssignmentProblem.createMany({
                data: mappings,
                skipDuplicates: true,
              });
            }
          }
        }
      }

      // Final set includes all existing problems + new problems
      const finalProblemIds = [...existingProblemIds, ...newProblemIds];

      const updated = await prisma.assignment.findUnique({
        where: { id: assignmentId },
        include: {
          problems: {
            include: { problem: true },
          },
        },
      });

      const problems =
        updated?.problems?.map(
          (ap: NonNullable<typeof updated>['problems'][number]) => ap.problem,
        ) ?? [];

      // Log the action to the ActivityLog
      try {
        await createEnhancedActivityLog(prisma, req, {
          userId: user.id,
          action: 'UPDATE_ASSIGNMENT_PROBLEMS',
          severity: 'INFO',
          category: 'ASSIGNMENT',
          courseId,
          assignmentId,
          metadata: {
            userId: user.id,
            courseId: courseId,
            assignmentId: assignmentId,
            addedProblemIds: newProblemIds,
            protectedProblemIds: linksWithSubmissions.map(
              (link: (typeof linksWithSubmissions)[number]) => link.problemId,
            ),
            finalProblemIds: finalProblemIds,
            linksWithSubmissions: linksWithSubmissions.length,
          },
        });
      } catch (logError) {
        console.warn('Failed to log activity:', logError);
        // Don't fail the whole request if logging fails
      }

      // Respond with the updated problem list and information about protected problems
      const response = {
        success: true,
        problems,
        metadata: {
          totalProblems: problems.length,
          newProblemsAdded: newProblemIds.length,
          protectedProblems: linksWithSubmissions.length,
          message:
            linksWithSubmissions.length > 0
              ? `Added ${newProblemIds.length} new problems. ${linksWithSubmissions.length} existing problems with submissions were preserved.`
              : `Successfully updated assignment with ${finalProblemIds.length} problems.`,
        },
      };

      return NextResponse.json(response);
    } catch (err) {
      // Handle unexpected errors
      console.error('Failed to update assignment problems:', err);
      await createEnhancedActivityLog(prisma, req, {
        userId: null,
        action: 'ASSIGNMENT_ADD_PROBLEMS_ERROR',
        severity: 'ERROR',
        metadata: { error: err instanceof Error ? err.message : 'unknown error' },
      });
      return NextResponse.json({ error: 'Failed to update assignment problems.' }, { status: 500 });
    }
  },
  { access: 'manage', deniedAction: 'ASSIGNMENT_ADD_PROBLEMS_DENIED', blockWhenArchived: true },
);

/**
 * Detaches a problem from an assignment (and clears any group→problem mappings for
 * it), leaving the problem itself intact in the course. Course staff (faculty or
 * TAs) or a system admin. Both the assignment and the problem must belong to the
 * course in the path. The problem id travels in the request body.
 * @openapi
 * summary: Remove a problem from an assignment
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 *   - { name: aid, in: path, required: true, schema: { type: string } }
 * requestBody:
 *   required: true
 *   content:
 *     application/json:
 *       schema: { type: object, required: [problemId], properties: { problemId: { type: string } } }
 * responses:
 *   200: { description: The assignment's remaining problems. }
 *   400: { description: Missing problemId. }
 *   401: { description: Not signed in. }
 *   403: { description: Caller is not course staff (faculty or TA) or a system admin. }
 *   404: { description: Assignment or problem not found in this course. }
 *   500: { description: Server error. }
 */
export const DELETE = withCourseAuth(
  async (req, ctx, { user, courseId }) => {
    const { aid: assignmentId } = await ctx.params;

    try {
      // Parse the problemId from the request body
      const { problemId } = await req.json();

      if (!problemId) {
        return NextResponse.json({ error: 'Missing problemId.' }, { status: 400 });
      }

      // Validate that both the assignment and the problem exist and belong to the
      // course. Independent reads → run concurrently; the assignment is still
      // checked first so its 404 takes precedence, preserving prior behavior.
      const [assignment, problem] = await Promise.all([
        prisma.assignment.findFirst({ where: { id: assignmentId, courseId } }),
        prisma.problem.findFirst({ where: { id: problemId, courseId } }),
      ]);

      if (!assignment) {
        return NextResponse.json({ error: 'Assignment not found.' }, { status: 404 });
      }

      if (!problem) {
        return NextResponse.json({ error: 'Problem not found in this course.' }, { status: 404 });
      }

      // Delete the link between the assignment and the problem
      await prisma.assignmentProblem.deleteMany({
        where: {
          assignmentId,
          problemId,
        },
      });

      // Also remove any group-specific mappings for this assignment/problem so
      // the problem is fully unassigned from groups when removed from the
      // assignment.
      await prisma.groupAssignmentProblem.deleteMany({ where: { assignmentId, problemId } });

      // Retrieve updated problem list for this assignment
      const updated = (await prisma.assignment.findUnique({
        where: { id: assignmentId },
        select: {
          problems: {
            select: {
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
          },
        },
      })) as AssignmentWithProblems | null;

      const problems =
        updated?.problems.map(
          (ap: NonNullable<typeof updated>['problems'][number]) => ap.problem,
        ) || [];

      // Log the removal action
      await createEnhancedActivityLog(prisma, req, {
        userId: user.id,
        action: 'REMOVE_ASSIGNMENT_PROBLEM',
        severity: 'INFO',
        category: 'ASSIGNMENT',
        courseId,
        assignmentId,
        problemId,
        metadata: {
          userId: user.id,
          courseId: courseId,
          assignmentId: assignmentId,
          problemId: problemId,
          problemTitle: problem.title,
        },
      });

      // Return the updated list of problems
      return NextResponse.json({ success: true, problems });
    } catch (error) {
      console.error('Error removing problem from assignment:', error);
      await createEnhancedActivityLog(prisma, req, {
        userId: user.id,
        action: 'ASSIGNMENT_REMOVE_PROBLEM_ERROR',
        severity: 'ERROR',
        metadata: { error: error instanceof Error ? error.message : 'unknown error' },
      });
      return NextResponse.json({ error: 'Failed to remove problem.' }, { status: 500 });
    }
  },
  { access: 'manage', deniedAction: 'ASSIGNMENT_REMOVE_PROBLEM_DENIED', blockWhenArchived: true },
);
