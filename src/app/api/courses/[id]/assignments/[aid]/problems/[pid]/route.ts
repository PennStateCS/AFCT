import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { withCourseAuth } from '@/lib/api/with-auth';
import { logError } from '@/lib/api/activity';
import {
  AssignmentProblemSettingsSchema,
  type AssignmentProblemSettingsInput,
} from '@/schemas/problem';

// Concrete path params for this route. Next guarantees each dynamic segment is
// present, so typing them keeps the destructured values `string` (rather than
// `string | undefined`) under noUncheckedIndexedAccess.
type RouteCtx = { params: Promise<{ id: string; aid: string; pid: string }> };

/**
 * Updates the per-assignment settings for one problem: its point value, submission
 * cap, and whether the autograder runs. Course staff (faculty or TAs) or a system
 * admin. The problem
 * must already be linked to the assignment, and the assignment must belong to the
 * course in the path.
 * @openapi
 * summary: Update an assignment problem's settings
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 *   - { name: aid, in: path, required: true, schema: { type: string } }
 *   - { name: pid, in: path, required: true, schema: { type: string } }
 * requestBody:
 *   required: true
 *   content:
 *     application/json:
 *       schema:
 *         type: object
 *         required: [maxPoints, maxSubmissions, autograderEnabled]
 *         properties:
 *           maxPoints: { type: number, minimum: 0 }
 *           maxSubmissions: { type: integer, description: "-1 for unlimited, else >= 1" }
 *           autograderEnabled: { type: boolean }
 * responses:
 *   200: { description: The updated assignment-problem settings. }
 *   400: { description: Invalid JSON or settings. }
 *   401: { description: Not signed in. }
 *   403: { description: Caller is not course staff (faculty or TA) or a system admin. }
 *   404: { description: The problem isn't linked to this assignment/course. }
 *   500: { description: Server error. }
 */
export const PUT = withCourseAuth(
  async (req, ctx: RouteCtx, { user, courseId }) => {
    const { aid: assignmentId, pid: problemId } = await ctx.params;

    try {
      let payload: AssignmentProblemSettingsInput;
      try {
        const body = await req.json();
        const parsed = AssignmentProblemSettingsSchema.safeParse(body);

        if (!parsed.success) {
          const message = parsed.error.issues.at(0)?.message ?? 'Invalid payload.';
          return NextResponse.json({ error: message }, { status: 400 });
        }

        payload = parsed.data;
      } catch {
        return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
      }

      const link = await prisma.assignmentProblem.findUnique({
        where: {
          assignmentId_problemId: {
            assignmentId,
            problemId,
          },
        },
        include: {
          assignment: {
            select: {
              courseId: true,
            },
          },
          problem: {
            select: {
              title: true,
            },
          },
        },
      });

      if (!link || link.assignment.courseId !== courseId) {
        return NextResponse.json({ error: 'Assignment problem link not found.' }, { status: 404 });
      }

      const updated = await prisma.assignmentProblem.update({
        where: {
          assignmentId_problemId: {
            assignmentId,
            problemId,
          },
        },
        data: payload,
        select: {
          assignmentId: true,
          problemId: true,
          maxPoints: true,
          maxSubmissions: true,
          autograderEnabled: true,
        },
      });

      try {
        await createEnhancedActivityLog(prisma, req, {
          userId: user.id,
          action: 'UPDATE_ASSIGNMENT_PROBLEM_SETTINGS',
          severity: 'INFO',
          category: 'ASSIGNMENT',
          courseId,
          assignmentId,
          problemId,
          metadata: {
            userId: user.id,
            assignmentId,
            problemId,
            courseId,
            maxPoints: payload.maxPoints,
            maxSubmissions: payload.maxSubmissions,
            autograderEnabled: payload.autograderEnabled,
            problemTitle: link.problem.title,
          },
        });
      } catch (logErr) {
        console.warn('Failed to log assignment problem update:', logErr);
      }

      return NextResponse.json({ success: true, assignmentProblem: updated });
    } catch (error) {
      console.error('Failed to update assignment problem settings:', error);
      await logError(req, {
        userId: user.id,
        action: 'ASSIGNMENT_PROBLEM_SETTINGS_UPDATE_ERROR',
        category: 'PROBLEM',
        courseId,
        assignmentId,
        problemId,
        error,
      });
      return NextResponse.json(
        { error: 'Failed to update assignment problem settings.' },
        { status: 500 },
      );
    }
  },
  { access: 'manage', deniedAction: 'ASSIGNMENT_PROBLEM_SETTINGS_UPDATE_DENIED', blockWhenArchived: true },
);
