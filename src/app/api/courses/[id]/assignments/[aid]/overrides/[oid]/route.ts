import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withCourseAuth } from '@/lib/api/with-auth';
import { readJson } from '@/lib/api/request';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { logError } from '@/lib/api/activity';
import { resolveCourseTimezone } from '@/lib/course-timezone';
import { resolveOverrideFields } from '@/lib/assignment-overrides';
import { OverrideUpdateApiSchema } from '@/schemas/assignment';

type Ctx = { params: Promise<{ id: string; aid: string; oid: string }> };

// Confirms the override belongs to the assignment, which belongs to the course, and
// returns it (with the assignment's base fields) or null.
async function loadOverride(courseId: string, aid: string, oid: string) {
  const override = await prisma.assignmentOverride.findFirst({
    where: { id: oid, assignmentId: aid, assignment: { courseId } },
    include: {
      assignment: {
        select: { unlockAt: true, dueDate: true, lateCutoff: true, allowLateSubmissions: true },
      },
    },
  });
  return override;
}

/**
 * Updates a per-student due-date override. Course staff (faculty or TAs) or a system
 * admin. Omitted fields keep their current value; null inherits the base.
 * @openapi
 * summary: Update an assignment due-date override
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 *   - { name: aid, in: path, required: true, schema: { type: string } }
 *   - { name: oid, in: path, required: true, schema: { type: string } }
 * requestBody:
 *   required: true
 *   content:
 *     application/json:
 *       schema:
 *         type: object
 *         properties:
 *           unlockAt: { type: string, nullable: true }
 *           dueDate: { type: string, nullable: true }
 *           lateCutoff: { type: string, nullable: true }
 *           allowLateSubmissions: { type: boolean, nullable: true }
 * responses:
 *   200: { description: The updated override. }
 *   400: { description: "Invalid window." }
 *   401: { description: Not signed in. }
 *   403: { description: Not course staff or a system admin. }
 *   404: { description: Override not found. }
 *   500: { description: Server error. }
 */
export const PATCH = withCourseAuth(
  async (req, ctx: Ctx, { user, courseId }) => {
    const { aid, oid } = await ctx.params;
    try {
      const existing = await loadOverride(courseId, aid, oid);
      if (!existing) {
        return NextResponse.json({ error: 'Override not found' }, { status: 404 });
      }

      const parsed = await readJson(req, OverrideUpdateApiSchema);
      if (!parsed.ok) return parsed.response;

      const timezone = await resolveCourseTimezone(courseId);
      const resolved = resolveOverrideFields({
        incoming: parsed.data,
        existing: {
          unlockAt: existing.unlockAt,
          dueDate: existing.dueDate,
          lateCutoff: existing.lateCutoff,
          allowLateSubmissions: existing.allowLateSubmissions,
        },
        base: existing.assignment,
        timezone,
      });
      if (!resolved.ok) {
        return NextResponse.json({ error: resolved.message }, { status: 400 });
      }

      const updated = await prisma.assignmentOverride.update({
        where: { id: oid },
        data: resolved.fields,
      });

      await createEnhancedActivityLog(prisma, req, {
        userId: user.id,
        action: 'UPDATE_ASSIGNMENT_OVERRIDE',
        severity: 'INFO',
        category: 'ASSIGNMENT',
        courseId,
        assignmentId: aid,
        metadata: {
          overrideId: oid,
          targetUserId: existing.userId,
          previousDueDate: existing.dueDate ? existing.dueDate.toISOString() : null,
          dueDate: updated.dueDate ? updated.dueDate.toISOString() : null,
          unlockAt: updated.unlockAt ? updated.unlockAt.toISOString() : null,
          lateCutoff: updated.lateCutoff ? updated.lateCutoff.toISOString() : null,
          allowLateSubmissions: updated.allowLateSubmissions,
        },
      });

      return NextResponse.json(updated);
    } catch (error) {
      console.error('PATCH assignment override error:', error);
      await logError(req, {
        userId: user.id,
        action: 'ASSIGNMENT_OVERRIDE_UPDATE_ERROR',
        category: 'ASSIGNMENT',
        courseId,
        assignmentId: aid,
        error,
      });
      return NextResponse.json({ error: 'Failed to update override' }, { status: 500 });
    }
  },
  { access: 'manage', deniedAction: 'ASSIGNMENT_OVERRIDE_UPDATE_DENIED', blockWhenArchived: true },
);

/**
 * Deletes a per-student due-date override (the student falls back to the base dates).
 * Course staff (faculty or TAs) or a system admin.
 * @openapi
 * summary: Delete an assignment due-date override
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 *   - { name: aid, in: path, required: true, schema: { type: string } }
 *   - { name: oid, in: path, required: true, schema: { type: string } }
 * responses:
 *   200: { description: Deleted. }
 *   401: { description: Not signed in. }
 *   403: { description: Not course staff or a system admin. }
 *   404: { description: Override not found. }
 *   500: { description: Server error. }
 */
export const DELETE = withCourseAuth(
  async (req, ctx: Ctx, { user, courseId }) => {
    const { aid, oid } = await ctx.params;
    try {
      const existing = await loadOverride(courseId, aid, oid);
      if (!existing) {
        return NextResponse.json({ error: 'Override not found' }, { status: 404 });
      }

      await prisma.assignmentOverride.delete({ where: { id: oid } });

      await createEnhancedActivityLog(prisma, req, {
        userId: user.id,
        action: 'DELETE_ASSIGNMENT_OVERRIDE',
        severity: 'INFO',
        category: 'ASSIGNMENT',
        courseId,
        assignmentId: aid,
        metadata: {
          overrideId: oid,
          targetUserId: existing.userId,
          previousDueDate: existing.dueDate ? existing.dueDate.toISOString() : null,
        },
      });

      return NextResponse.json({ success: true });
    } catch (error) {
      console.error('DELETE assignment override error:', error);
      await logError(req, {
        userId: user.id,
        action: 'ASSIGNMENT_OVERRIDE_DELETE_ERROR',
        category: 'ASSIGNMENT',
        courseId,
        assignmentId: aid,
        error,
      });
      return NextResponse.json({ error: 'Failed to delete override' }, { status: 500 });
    }
  },
  { access: 'manage', deniedAction: 'ASSIGNMENT_OVERRIDE_DELETE_DENIED', blockWhenArchived: true },
);
