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
          unlockAt: true,
          dueDate: true,
          lateCutoff: true,
          allowLateSubmissions: true,
          user: { select: { id: true, firstName: true, lastName: true, email: true } },
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
 *         required: [userId]
 *         properties:
 *           userId: { type: string }
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
        },
      });
      if (!assignment) {
        return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
      }

      const parsed = await readJson(req, OverrideCreateApiSchema);
      if (!parsed.ok) return parsed.response;
      const data = parsed.data;

      // The target must be a STUDENT enrolled in the course.
      const rosterEntry = await prisma.roster.findUnique({
        where: { courseId_userId: { courseId, userId: data.userId } },
        select: { role: true },
      });
      if (!rosterEntry || rosterEntry.role !== 'STUDENT') {
        // Not an auth denial of the caller (they can manage the course); the target is
        // invalid. Record it at SECURITY for audit, but answer 400 like the sibling
        // group-members route does for a non-enrolled target.
        await createEnhancedActivityLog(prisma, req, {
          userId: user.id,
          action: 'ASSIGNMENT_OVERRIDE_TARGET_INVALID',
          severity: 'SECURITY',
          category: 'ASSIGNMENT',
          courseId,
          assignmentId: aid,
          metadata: { targetUserId: data.userId, reason: 'not a student on the roster' },
        });
        return NextResponse.json(
          { error: 'Target must be a student enrolled in this course.' },
          { status: 400 },
        );
      }

      const timezone = await resolveCourseTimezone(courseId);
      const resolved = resolveOverrideFields({
        incoming: data,
        existing: null,
        base: assignment,
        timezone,
      });
      if (!resolved.ok) {
        return NextResponse.json({ error: resolved.message }, { status: 400 });
      }

      let created;
      try {
        created = await prisma.assignmentOverride.create({
          data: {
            targetType: 'STUDENT',
            assignmentId: aid,
            userId: data.userId,
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
