import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withCourseAuth } from '@/lib/api/with-auth';
import { readJson } from '@/lib/api/request';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { logError } from '@/lib/api/activity';
import { AssignmentTypeApiSchema } from '@/schemas/assignment';

type Ctx = { params: Promise<{ id: string; aid: string }> };

/** Thrown inside the transaction so the whole change rolls back rather than half-applying. */
class AssignmentHasWorkError extends Error {}

/**
 * Changes an assignment's individual/group type. Course staff (faculty or TAs) or a system
 * admin. `groupSetId: null` makes it individual; a set id makes it a group assignment tied
 * to that set. Because assignees and date overrides reference the old type's targets,
 * switching resets the audience to everyone and clears all assignees + overrides in one
 * transaction (staff rebuild them on the Assign To tab). Refused once any submission or grade
 * exists, because the change would reinterpret that work.
 * @openapi
 * summary: Change an assignment's individual/group type
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 *   - { name: aid, in: path, required: true, schema: { type: string } }
 * requestBody:
 *   required: true
 *   content:
 *     application/json:
 *       schema:
 *         type: object
 *         required: [groupSetId]
 *         properties:
 *           groupSetId: { type: string, nullable: true, description: "Null for individual; a group set id for group" }
 * responses:
 *   200: { description: The updated assignment. }
 *   400: { description: "Group set not found in this course." }
 *   401: { description: Not signed in. }
 *   403: { description: Not course staff or a system admin. }
 *   404: { description: Assignment not found in this course. }
 *   409: { description: "The assignment already has submissions or grades, so its type is frozen." }
 *   500: { description: Server error. }
 */
export const PUT = withCourseAuth(
  async (req, ctx: Ctx, { user, courseId }) => {
    const { aid } = await ctx.params;
    try {
      const assignment = await prisma.assignment.findFirst({
        where: { id: aid, courseId },
        select: { id: true, groupSetId: true },
      });
      if (!assignment) {
        return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
      }

      const parsed = await readJson(req, AssignmentTypeApiSchema);
      if (!parsed.ok) return parsed.response;
      const nextGroupSetId = parsed.data.groupSetId;

      if (nextGroupSetId) {
        const set = await prisma.groupSet.findFirst({
          where: { id: nextGroupSetId, courseId },
          select: { id: true },
        });
        if (!set) {
          return NextResponse.json(
            { error: 'Group set not found in this course.' },
            { status: 400 },
          );
        }
      }

      /**
       * The type is frozen once there is student work, and the guard holds the lock.
       *
       * Changing it rewrites what the existing work means. Individual attempts end up inside an
       * assignment now read as group work, and group attempts end up pointing at groups from a
       * set the assignment no longer uses, which is what decides who a grade fans out to. The
       * same call also clears every date override, so a student's extension disappears from
       * under work already handed in under it.
       *
       * Locked first for the same reason the deletes are: counting and then updating is a
       * check-then-act, and a submission that commits in the gap would be reinterpreted by a
       * decision taken before it existed. Submissions and grades both reach the assignment
       * through its problem links, so those are the rows to hold.
       */
      const updated = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT 1 FROM "AssignmentProblem" WHERE "assignmentId" = ${aid} FOR UPDATE`;

        const [submissionCount, gradeCount] = await Promise.all([
          tx.submission.count({ where: { assignmentId: aid } }),
          tx.assignmentProblemGrade.count({ where: { assignmentId: aid } }),
        ]);
        if (submissionCount > 0 || gradeCount > 0) {
          throw new AssignmentHasWorkError();
        }

        // Switching type invalidates the current audience + exceptions, so reset to everyone
        // and clear the assignee + override rows together with the type change.
        await tx.assignmentAssignee.deleteMany({ where: { assignmentId: aid } });
        await tx.assignmentOverride.deleteMany({ where: { assignmentId: aid } });
        return tx.assignment.update({
          where: { id: aid },
          data: { groupSetId: nextGroupSetId, assignedToEveryone: true },
        });
      });

      await createEnhancedActivityLog(prisma, req, {
        userId: user.id,
        action: 'CHANGE_ASSIGNMENT_TYPE',
        severity: 'INFO',
        category: 'ASSIGNMENT',
        courseId,
        assignmentId: aid,
        metadata: {
          previousGroupSetId: assignment.groupSetId,
          groupSetId: nextGroupSetId,
          isGroup: nextGroupSetId != null,
        },
      });

      return NextResponse.json(updated);
    } catch (error) {
      if (error instanceof AssignmentHasWorkError) {
        return NextResponse.json(
          {
            error:
              'This assignment already has student work, so individual and group cannot be switched. Duplicate it instead.',
          },
          { status: 409 },
        );
      }
      console.error('Assignment type change failed:', error);
      await logError(req, {
        userId: user.id,
        action: 'ASSIGNMENT_TYPE_CHANGE_ERROR',
        category: 'ASSIGNMENT',
        courseId,
        assignmentId: aid,
        error,
      });
      return NextResponse.json({ error: 'Failed to change assignment type' }, { status: 500 });
    }
  },
  { access: 'manage', deniedAction: 'ASSIGNMENT_TYPE_CHANGE_DENIED', blockWhenArchived: true },
);
