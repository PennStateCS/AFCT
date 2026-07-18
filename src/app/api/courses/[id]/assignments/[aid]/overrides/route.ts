import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { withCourseAuth } from '@/lib/api/with-auth';
import { readJson } from '@/lib/api/request';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { logError } from '@/lib/api/activity';
import { resolveCourseTimezone } from '@/lib/course-timezone';
import { resolveOverrideFields } from '@/lib/assignment-overrides';
import { OverrideCreateApiSchema } from '@/schemas/assignment';

type Ctx = { params: Promise<{ id: string; aid: string }> };

/**
 * Lists the per-student due-date overrides for an assignment. Course staff (faculty or
 * TAs) or a system admin.
 * @openapi
 * summary: List an assignment's due-date overrides
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 *   - { name: aid, in: path, required: true, schema: { type: string } }
 * responses:
 *   200: { description: The assignment's overrides. }
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

      const overrides = await prisma.assignmentOverride.findMany({
        where: { assignmentId: aid },
        select: {
          id: true,
          targetType: true,
          userId: true,
          groupId: true,
          unlockAt: true,
          dueDate: true,
          lateCutoff: true,
          allowLateSubmissions: true,
          user: { select: { id: true, firstName: true, lastName: true, email: true } },
          studentGroup: {
            select: { id: true, name: true, _count: { select: { memberships: true } } },
          },
        },
        orderBy: { createdAt: 'asc' },
      });

      return NextResponse.json(overrides);
    } catch (error) {
      console.error('GET assignment overrides error:', error);
      return NextResponse.json({ error: 'Failed to load overrides' }, { status: 500 });
    }
  },
  { access: 'manage', deniedAction: 'ASSIGNMENT_OVERRIDES_ACCESS_DENIED' },
);

/**
 * Creates a per-student due-date override. Course staff (faculty or TAs) or a system
 * admin. The target must be a student enrolled in the course. Dates are interpreted in
 * the course's timezone; the effective window (override values falling back to the base)
 * must stay ordered.
 * @openapi
 * summary: Create an assignment due-date override
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
 *           userId: { type: string, description: Student target (exactly one of userId or groupId) }
 *           groupId: { type: string, description: Group target (a StudentGroup in the assignment's group set) }
 *           unlockAt: { type: string, nullable: true }
 *           dueDate: { type: string, nullable: true }
 *           lateCutoff: { type: string, nullable: true }
 *           allowLateSubmissions: { type: boolean, nullable: true }
 * responses:
 *   201: { description: The created override. }
 *   400: { description: "Invalid target or window." }
 *   401: { description: Not signed in. }
 *   403: { description: Not course staff or a system admin. }
 *   404: { description: Assignment not found in this course. }
 *   409: { description: An override already exists for this student. }
 *   500: { description: Server error. }
 */
export const POST = withCourseAuth(
  async (req, ctx: Ctx, { user, courseId }) => {
    const { aid } = await ctx.params;
    try {
      const assignment = await prisma.assignment.findFirst({
        where: { id: aid, courseId },
        select: {
          id: true,
          unlockAt: true,
          dueDate: true,
          lateCutoff: true,
          allowLateSubmissions: true,
          assignedToEveryone: true,
          groupSetId: true,
        },
      });
      if (!assignment) {
        return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
      }

      const parsed = await readJson(req, OverrideCreateApiSchema);
      if (!parsed.ok) return parsed.response;
      const data = parsed.data;

      const timezone = await resolveCourseTimezone(courseId);
      const invalidTarget = async (targetMeta: Record<string, string>, message: string) => {
        await createEnhancedActivityLog(prisma, req, {
          userId: user.id,
          action: 'ASSIGNMENT_OVERRIDE_TARGET_INVALID',
          severity: 'SECURITY',
          category: 'ASSIGNMENT',
          courseId,
          assignmentId: aid,
          metadata: targetMeta,
        });
        return NextResponse.json({ error: message }, { status: 400 });
      };

      let created;
      if (data.groupId) {
        // ── GROUP target ──────────────────────────────────────────────────────
        const group = await prisma.studentGroup.findFirst({
          where: { id: data.groupId, groupSet: { courseId } },
          select: { id: true, groupSetId: true },
        });
        if (!group) {
          return invalidTarget(
            { targetGroupId: data.groupId, reason: 'group not in this course' },
            'Target group not found in this course.',
          );
        }
        // Group targets on one assignment must all come from a single group set.
        if (assignment.groupSetId && assignment.groupSetId !== group.groupSetId) {
          return NextResponse.json(
            { error: "Groups must come from this assignment's group set." },
            { status: 400 },
          );
        }
        // No double-targeting: none of the group's members may be targeted individually.
        const memberIds = (
          await prisma.groupMembership.findMany({
            where: { groupId: group.id },
            select: { userId: true },
          })
        ).map((m) => m.userId);
        const studentClash = await prisma.assignmentOverride.findFirst({
          where: { assignmentId: aid, targetType: 'STUDENT', userId: { in: memberIds } },
          select: { id: true },
        });
        if (studentClash) {
          return NextResponse.json(
            { error: 'A student in this group is already assigned individually for this assignment.' },
            { status: 400 },
          );
        }

        const resolved = resolveOverrideFields({
          incoming: data,
          existing: null,
          base: assignment,
          timezone,
          allowEmpty: true, // a group target may just assign the group with the base window
        });
        if (!resolved.ok) return NextResponse.json({ error: resolved.message }, { status: 400 });

        try {
          created = await prisma.$transaction(async (tx) => {
            const row = await tx.assignmentOverride.create({
              data: {
                targetType: 'GROUP',
                assignmentId: aid,
                groupId: group.id,
                createdById: user.id,
                ...resolved.fields,
              },
            });
            // Pin the assignment to this set and stop assigning everyone individually.
            await tx.assignment.update({
              where: { id: aid },
              data: { groupSetId: group.groupSetId, assignedToEveryone: false },
            });
            return row;
          });
        } catch (err) {
          if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
            return NextResponse.json(
              { error: 'This group is already targeted for this assignment.' },
              { status: 409 },
            );
          }
          throw err;
        }
      } else {
        // ── STUDENT target ────────────────────────────────────────────────────
        const userId = data.userId as string;
        const rosterEntry = await prisma.roster.findUnique({
          where: { courseId_userId: { courseId, userId } },
          select: { role: true },
        });
        if (!rosterEntry || rosterEntry.role !== 'STUDENT') {
          return invalidTarget(
            { targetUserId: userId, reason: 'not a student on the roster' },
            'Target must be a student enrolled in this course.',
          );
        }
        // No double-targeting: the student must not be in a group targeted on this assignment.
        const groupClash = await prisma.assignmentOverride.findFirst({
          where: {
            assignmentId: aid,
            targetType: 'GROUP',
            studentGroup: { memberships: { some: { userId } } },
          },
          select: { id: true },
        });
        if (groupClash) {
          return NextResponse.json(
            { error: 'This student is already assigned through a group for this assignment.' },
            { status: 400 },
          );
        }

        const resolved = resolveOverrideFields({
          incoming: data,
          existing: null,
          base: assignment,
          timezone,
          allowEmpty: assignment.assignedToEveryone === false,
        });
        if (!resolved.ok) return NextResponse.json({ error: resolved.message }, { status: 400 });

        try {
          created = await prisma.assignmentOverride.create({
            data: {
              targetType: 'STUDENT',
              assignmentId: aid,
              userId,
              createdById: user.id,
              ...resolved.fields,
            },
          });
        } catch (err) {
          if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
            return NextResponse.json(
              { error: 'An override already exists for this student.' },
              { status: 409 },
            );
          }
          throw err;
        }
      }

      await createEnhancedActivityLog(prisma, req, {
        userId: user.id,
        action: 'CREATE_ASSIGNMENT_OVERRIDE',
        severity: 'INFO',
        category: 'ASSIGNMENT',
        courseId,
        assignmentId: aid,
        metadata: {
          overrideId: created.id,
          targetUserId: created.userId,
          targetGroupId: created.groupId,
          targetType: created.targetType,
          unlockAt: created.unlockAt ? created.unlockAt.toISOString() : null,
          dueDate: created.dueDate ? created.dueDate.toISOString() : null,
          lateCutoff: created.lateCutoff ? created.lateCutoff.toISOString() : null,
          allowLateSubmissions: created.allowLateSubmissions,
        },
      });

      return NextResponse.json(created, { status: 201 });
    } catch (error) {
      console.error('POST assignment override error:', error);
      await logError(req, {
        userId: user.id,
        action: 'ASSIGNMENT_OVERRIDE_CREATE_ERROR',
        category: 'ASSIGNMENT',
        courseId,
        assignmentId: aid,
        error,
      });
      return NextResponse.json({ error: 'Failed to create override' }, { status: 500 });
    }
  },
  { access: 'manage', deniedAction: 'ASSIGNMENT_OVERRIDE_CREATE_DENIED', blockWhenArchived: true },
);
