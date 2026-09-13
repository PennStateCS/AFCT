import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { withCourseAuth } from '@/lib/api/with-auth';
import { diffFields, logError } from '@/lib/api/activity';
import {
  AssignmentProblemSettingsSchema,
  type AssignmentProblemSettingsInput,
} from '@/schemas/problem';

// Concrete path params for this route. Next guarantees each dynamic segment is
// present, so typing them keeps the destructured values `string` (rather than
// `string | undefined`) under noUncheckedIndexedAccess.
type RouteCtx = { params: Promise<{ id: string; aid: string; pid: string }> };

/** Thrown inside the settings transaction when the new points would sit below a grade given. */
class MaxPointsBelowGradesError extends Error {}

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
 *           showFeedback: { type: boolean, description: "Whether students see the evaluator's feedback, or only whether they were right. Defaults to true when omitted." }
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

      /**
       * Lowering the points has to answer for the marks already given.
       *
       * Grades are validated against `maxPoints` when they are entered, and nothing checked the
       * other direction: dropping a 10-point problem to 5 left a student sitting at 10/5. It
       * reaches the LMS as `scoreGiven` above `scoreMaximum`, which is not a value AGS accepts.
       *
       * The link's row is held while this decides, which is also the row a grade write attaches
       * to, so a grader validating against the old maximum cannot commit after the change.
       */
      let highestGrade: number | null = null;
      const updated = await prisma
        .$transaction(async (tx) => {
          await tx.$queryRaw`
          SELECT 1 FROM "AssignmentProblem"
          WHERE "assignmentId" = ${assignmentId} AND "problemId" = ${problemId}
          FOR UPDATE
        `;

          if (payload.maxPoints !== undefined && payload.maxPoints < link.maxPoints) {
            const top = await tx.assignmentProblemGrade.findFirst({
              where: { assignmentId, problemId },
              orderBy: { grade: 'desc' },
              select: { grade: true },
            });
            if (top?.grade != null && top.grade > payload.maxPoints) {
              highestGrade = top.grade;
              throw new MaxPointsBelowGradesError();
            }
          }

          return tx.assignmentProblem.update({
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
              showFeedback: true,
            },
          });
        })
        .catch((err) => {
          if (err instanceof MaxPointsBelowGradesError) return null;
          throw err;
        });

      if (!updated) {
        return NextResponse.json(
          {
            error: `A grade of ${highestGrade} has already been given on this problem, so it cannot be worth fewer than ${highestGrade} points. Change those grades first.`,
          },
          { status: 409 },
        );
      }

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
            // Points especially: changing them rescales every grade already given for this
            // problem, so "what was it worth before" has to be answerable.
            changes: diffFields(
              link as unknown as Record<string, unknown>,
              updated as unknown as Record<string, unknown>,
              ['maxPoints', 'maxSubmissions', 'autograderEnabled', 'showFeedback'],
            ),
            maxPoints: payload.maxPoints,
            maxSubmissions: payload.maxSubmissions,
            autograderEnabled: payload.autograderEnabled,
            showFeedback: payload.showFeedback,
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
  {
    access: 'manage',
    deniedAction: 'ASSIGNMENT_PROBLEM_SETTINGS_UPDATE_DENIED',
    blockWhenArchived: true,
  },
);

/**
 * The per-assignment settings for one problem, plus how many attempts have already been made
 * against it.
 *
 * The count exists for one screen: turning feedback off (or back on) partway through changes
 * what students see from that moment, and the people who already submitted keep whatever they
 * were shown. The settings dialog says how many that is, so the change is a decision rather
 * than a surprise. Nothing else needs it, which is why it is not on the assignment payload.
 * @openapi
 * summary: Get one problem's per-assignment settings
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 *   - { name: aid, in: path, required: true, schema: { type: string } }
 *   - { name: pid, in: path, required: true, schema: { type: string } }
 * responses:
 *   200:
 *     description: The settings, and the number of attempts already made.
 *     content:
 *       application/json:
 *         schema:
 *           type: object
 *           properties:
 *             maxPoints: { type: number }
 *             maxSubmissions: { type: integer }
 *             autograderEnabled: { type: boolean }
 *             showFeedback: { type: boolean }
 *             submissionCount: { type: integer }
 *   401: { description: Not signed in. }
 *   403: { description: Caller is not course staff (faculty or TA) or a system admin. }
 *   404: { description: The problem isn't linked to this assignment/course. }
 *   500: { description: Server error. }
 */
export const GET = withCourseAuth(
  async (_req, ctx: RouteCtx, { courseId }) => {
    const { aid: assignmentId, pid: problemId } = await ctx.params;

    /**
     * Scoped to the course in the path, the way the PUT below already is.
     *
     * The wrapper authorises the caller against *this* course and then hands over the
     * assignment and problem ids from the URL. Looking the pair up without the course meant
     * somebody who runs one course could read another course's points, attempt cap, autograder
     * settings and submission count just by knowing its ids.
     */
    const link = await prisma.assignmentProblem.findFirst({
      where: { assignmentId, problemId, assignment: { courseId } },
      select: {
        maxPoints: true,
        maxSubmissions: true,
        autograderEnabled: true,
        showFeedback: true,
      },
    });

    if (!link) {
      return NextResponse.json({ error: 'Problem not found on this assignment.' }, { status: 404 });
    }

    const submissionCount = await prisma.submission.count({
      where: { assignmentId, problemId },
    });

    return NextResponse.json({ ...link, submissionCount });
  },
  { access: 'manage', deniedAction: 'ASSIGNMENT_PROBLEM_SETTINGS_VIEW_DENIED' },
);
