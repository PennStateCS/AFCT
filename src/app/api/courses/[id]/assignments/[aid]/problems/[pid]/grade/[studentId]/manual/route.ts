import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { withCourseAuth } from '@/lib/api/with-auth';
import { readJson } from '@/lib/api/request';
import { logError } from '@/lib/api/activity';

type RouteCtx = { params: Promise<{ id: string; aid: string; pid: string; studentId: string }> };

const ManualBody = z.object({ gradedManually: z.boolean() });

/**
 * Sets whether a grade was entered by a person, which is what stops the autograder
 * overwriting it on a re-run.
 *
 * Its own endpoint rather than a field on the grade write, because turning it off is not a
 * grading action: the number does not change, and the audit entry should say what actually
 * happened. Turning it off hands the grade back to the autograder, which may replace it the
 * next time that submission is re-run, so it is recorded as its own event.
 * @openapi
 * summary: Set whether a grade is manually held
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 *   - { name: aid, in: path, required: true, schema: { type: string } }
 *   - { name: pid, in: path, required: true, schema: { type: string } }
 *   - { name: studentId, in: path, required: true, schema: { type: string } }
 * requestBody:
 *   required: true
 *   content:
 *     application/json:
 *       schema:
 *         type: object
 *         required: [gradedManually]
 *         properties:
 *           gradedManually: { type: boolean, description: Hold the grade against the autograder. }
 * responses:
 *   200: { description: The new state. }
 *   400: { description: Bad body. }
 *   401: { description: Not signed in. }
 *   403: { description: Caller is not course staff (faculty or TA) or a system admin. }
 *   404: { description: No grade recorded for this student on this problem. }
 *   500: { description: Server error. }
 */
export const PATCH = withCourseAuth(
  async (req, ctx: RouteCtx, { user, courseId }) => {
    const { aid: assignmentId, pid: problemId, studentId } = await ctx.params;

    try {
      const parsed = await readJson(req, ManualBody);
      if (!parsed.ok) return parsed.response;
      const { gradedManually } = parsed.data;

      // There is nothing to hold until a grade exists. Creating one here would invent a
      // score nobody entered.
      const existing = await prisma.assignmentProblemGrade.findFirst({
        where: {
          assignmentId,
          problemId,
          studentId,
          assignmentProblem: { assignment: { courseId } },
        },
        select: { id: true, grade: true, gradedManually: true },
      });
      if (!existing) {
        return NextResponse.json({ error: 'No grade recorded yet' }, { status: 404 });
      }

      if (existing.gradedManually !== gradedManually) {
        await prisma.assignmentProblemGrade.update({
          where: { id: existing.id },
          data: { gradedManually },
        });

        await createEnhancedActivityLog(prisma, req, {
          userId: user.id,
          // Releasing a grade to the autograder can change a student's mark later without
          // anyone touching it again, so it is logged as its own act rather than folded
          // into a grade update.
          action: gradedManually ? 'GRADE_HELD_MANUAL' : 'GRADE_RELEASED_TO_AUTOGRADER',
          severity: 'INFO',
          category: 'GRADE',
          courseId,
          assignmentId,
          problemId,
          metadata: { targetUserId: studentId, studentId, grade: existing.grade },
        });
      }

      return NextResponse.json({ gradedManually });
    } catch (error) {
      console.error('PATCH grade manual error:', error);
      await logError(req, {
        userId: user.id,
        action: 'GRADE_MANUAL_HOLD_ERROR',
        category: 'GRADE',
        error,
      });
      return NextResponse.json({ error: 'Failed to update the grade hold' }, { status: 500 });
    }
  },
  {
    access: 'manage',
    deniedAction: 'GRADE_MANUAL_HOLD_DENIED',
    deniedCategory: 'GRADE',
    // An archived course is read-only, and holding or releasing a grade changes who owns it.
    blockWhenArchived: true,
  },
);
