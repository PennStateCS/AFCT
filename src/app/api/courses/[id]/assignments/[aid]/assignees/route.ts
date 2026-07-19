import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withCourseAuth } from '@/lib/api/with-auth';
import { readJson } from '@/lib/api/request';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { logError } from '@/lib/api/activity';
import { AssigneesPutApiSchema } from '@/schemas/assignment';

type Ctx = { params: Promise<{ id: string; aid: string }> };

/**
 * Lists an assignment's audience (its AssignmentAssignee rows). Empty when the assignment
 * is assigned to everyone. Course staff (faculty or TAs) or a system admin.
 * @openapi
 * summary: List an assignment's assignees
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 *   - { name: aid, in: path, required: true, schema: { type: string } }
 * responses:
 *   200: { description: The assignment's assignee rows. }
 *   401: { description: Not signed in. }
 *   403: { description: Not course staff or a system admin. }
 *   404: { description: Assignment not found in this course. }
 *   500: { description: Server error. }
 */
export const GET = withCourseAuth(
  async (_req, ctx: Ctx, { courseId }) => {
    const { aid } = await ctx.params;
    try {
      const assignment = await prisma.assignment.findFirst({ where: { id: aid, courseId } });
      if (!assignment) {
        return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
      }
      const assignees = await prisma.assignmentAssignee.findMany({
        where: { assignmentId: aid },
        select: {
          id: true,
          targetType: true,
          userId: true,
          groupId: true,
          user: { select: { id: true, firstName: true, lastName: true, email: true } },
          studentGroup: {
            select: { id: true, name: true, _count: { select: { memberships: true } } },
          },
        },
        orderBy: { createdAt: 'asc' },
      });
      return NextResponse.json(assignees);
    } catch (error) {
      console.error('GET assignment assignees error:', error);
      return NextResponse.json({ error: 'Failed to load assignees' }, { status: 500 });
    }
  },
  { access: 'manage', deniedAction: 'ASSIGNMENT_ASSIGNEES_ACCESS_DENIED' },
);

/**
 * Replaces an assignment's audience. Course staff (faculty or TAs) or a system admin.
 * `assignedToEveryone` true clears the explicit list; false assigns only the given targets
 * (students for an individual assignment, groups for a group assignment). Overrides for
 * anyone no longer assigned are dropped in the same transaction.
 * @openapi
 * summary: Replace an assignment's audience
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 *   - { name: aid, in: path, required: true, schema: { type: string } }
 * requestBody:
 *   required: true
 *   content:
 *     application/json:
 *       schema:
 *         type: object
 *         required: [assignedToEveryone]
 *         properties:
 *           assignedToEveryone: { type: boolean }
 *           assignees:
 *             type: array
 *             description: "Required when assignedToEveryone is false; each item is one student (userId) or group (groupId)"
 *             items: { type: object, properties: { userId: { type: string }, groupId: { type: string } } }
 * responses:
 *   200: { description: The updated assignment. }
 *   400: { description: "Invalid audience for this assignment's type." }
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

      const parsed = await readJson(req, AssigneesPutApiSchema);
      if (!parsed.ok) return parsed.response;
      const { assignedToEveryone } = parsed.data;
      const isGroup = assignment.groupSetId != null;

      // Validate + collect the target ids (empty when assigned to everyone).
      const userIds: string[] = [];
      const groupIds: string[] = [];
      if (!assignedToEveryone) {
        if (isGroup) {
          const ids = parsed.data.assignees.map((a) => a.groupId).filter((v): v is string => !!v);
          if (ids.length !== parsed.data.assignees.length) {
            return NextResponse.json(
              { error: 'A group assignment can only be assigned to groups.' },
              { status: 400 },
            );
          }
          const found = await prisma.studentGroup.findMany({
            where: { id: { in: ids }, groupSetId: assignment.groupSetId ?? undefined },
            select: { id: true },
          });
          const ok = new Set(found.map((g) => g.id));
          if (ids.some((v) => !ok.has(v))) {
            return NextResponse.json(
              { error: "A group is not in this assignment's group set." },
              { status: 400 },
            );
          }
          groupIds.push(...new Set(ids));
        } else {
          const ids = parsed.data.assignees.map((a) => a.userId).filter((v): v is string => !!v);
          if (ids.length !== parsed.data.assignees.length) {
            return NextResponse.json(
              { error: 'An individual assignment can only be assigned to students.' },
              { status: 400 },
            );
          }
          const found = await prisma.roster.findMany({
            where: { courseId, userId: { in: ids }, role: 'STUDENT' },
            select: { userId: true },
          });
          const ok = new Set(found.map((r) => r.userId));
          if (ids.some((v) => !ok.has(v))) {
            return NextResponse.json(
              { error: 'A target is not a student enrolled in this course.' },
              { status: 400 },
            );
          }
          userIds.push(...new Set(ids));
        }
      }

      const updated = await prisma.$transaction(async (tx) => {
        // Replace the audience.
        await tx.assignmentAssignee.deleteMany({ where: { assignmentId: aid } });
        if (!assignedToEveryone) {
          await tx.assignmentAssignee.createMany({
            data: isGroup
              ? groupIds.map((groupId) => ({ assignmentId: aid, targetType: 'GROUP' as const, groupId }))
              : userIds.map((userId) => ({ assignmentId: aid, targetType: 'STUDENT' as const, userId })),
          });
          // Drop overrides for targets that are no longer assigned.
          if (isGroup) {
            await tx.assignmentOverride.deleteMany({
              where: { assignmentId: aid, groupId: { notIn: groupIds } },
            });
          } else {
            await tx.assignmentOverride.deleteMany({
              where: { assignmentId: aid, userId: { notIn: userIds } },
            });
          }
        }
        return tx.assignment.update({ where: { id: aid }, data: { assignedToEveryone } });
      });

      await createEnhancedActivityLog(prisma, req, {
        userId: user.id,
        action: 'UPDATE_ASSIGNMENT_AUDIENCE',
        severity: 'INFO',
        category: 'ASSIGNMENT',
        courseId,
        assignmentId: aid,
        metadata: {
          assignedToEveryone,
          assigneeCount: isGroup ? groupIds.length : userIds.length,
        },
      });

      return NextResponse.json(updated);
    } catch (error) {
      console.error('PUT assignment assignees error:', error);
      await logError(req, {
        userId: user.id,
        action: 'ASSIGNMENT_AUDIENCE_UPDATE_ERROR',
        category: 'ASSIGNMENT',
        courseId,
        assignmentId: aid,
        error,
      });
      return NextResponse.json({ error: 'Failed to update audience' }, { status: 500 });
    }
  },
  { access: 'manage', deniedAction: 'ASSIGNMENT_AUDIENCE_UPDATE_DENIED', blockWhenArchived: true },
);
