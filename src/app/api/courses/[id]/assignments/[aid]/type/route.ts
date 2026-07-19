import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withCourseAuth } from '@/lib/api/with-auth';
import { readJson } from '@/lib/api/request';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { logError } from '@/lib/api/activity';
import { AssignmentTypeApiSchema } from '@/schemas/assignment';

type Ctx = { params: Promise<{ id: string; aid: string }> };

/**
 * Changes an assignment's individual/group type. Course staff (faculty or TAs) or a system
 * admin. `groupSetId: null` makes it individual; a set id makes it a group assignment tied
 * to that set. Because assignees and date overrides reference the old type's targets,
 * switching resets the audience to everyone and clears all assignees + overrides in one
 * transaction (staff rebuild them on the Assign To tab).
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
          return NextResponse.json({ error: 'Group set not found in this course.' }, { status: 400 });
        }
      }

      // Switching type invalidates the current audience + exceptions, so reset to everyone
      // and clear the assignee + override rows together with the type change.
      const updated = await prisma.$transaction(async (tx) => {
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
