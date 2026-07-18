import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { withCourseAuth } from '@/lib/api/with-auth';
import { readJson } from '@/lib/api/request';
import { logError } from '@/lib/api/activity';
import { RenameGroupSetSchema } from '@/schemas/group-set';
import { normalizeName, groupSetDeletionBlockers } from '@/lib/group-sets';
import { findGroupSet, loadGroupSetDetail } from '@/lib/group-set-service';

/**
 * Full detail for one group set: its groups, each group's members (with an
 * inactive flag), and the eligible active-student roster. Course staff or admin.
 * @openapi
 * summary: Get a group set's detail
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 *   - { name: setId, in: path, required: true, schema: { type: string } }
 * responses:
 *   200: { description: The group set detail. }
 *   401: { description: Not signed in. }
 *   403: { description: Not course staff or a system admin. }
 *   404: { description: Group set not found in this course. }
 *   500: { description: Server error. }
 */
export const GET = withCourseAuth(
  async (req, ctx, { user, courseId }) => {
    const { setId } = await ctx.params;
    if (!setId) return NextResponse.json({ error: 'Missing params' }, { status: 400 });
    try {
      const detail = await loadGroupSetDetail(courseId, setId);
      if (!detail) return NextResponse.json({ error: 'Group set not found' }, { status: 404 });
      return NextResponse.json(detail);
    } catch (err) {
      console.error('[GROUP_SET_GET_ERROR]', err);
      await logError(req, {
        userId: user.id,
        action: 'GROUP_SET_VIEW_ERROR',
        category: 'COURSE',
        error: err,
        courseId,
      });
      return NextResponse.json({ error: 'Failed to fetch group set' }, { status: 500 });
    }
  },
  { access: 'manage', deniedAction: 'GROUP_SETS_VIEW_DENIED' },
);

/**
 * Renames a group set (allowed even when locked). Names are unique per course
 * (case-insensitive). Course staff or admin.
 * @openapi
 * summary: Rename a group set
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 *   - { name: setId, in: path, required: true, schema: { type: string } }
 * requestBody:
 *   required: true
 *   content:
 *     application/json:
 *       schema: { type: object, required: [name], properties: { name: { type: string } } }
 * responses:
 *   200: { description: The updated group set. }
 *   400: { description: Missing or invalid name. }
 *   401: { description: Not signed in. }
 *   403: { description: Not course staff or a system admin. }
 *   404: { description: Group set not found in this course. }
 *   409: { description: Name already used by another set in the course. }
 *   500: { description: Server error. }
 */
export const PATCH = withCourseAuth(
  async (req, ctx, { user, courseId }) => {
    const { setId } = await ctx.params;
    if (!setId) return NextResponse.json({ error: 'Missing params' }, { status: 400 });
    try {
      const parsed = await readJson(req, RenameGroupSetSchema);
      if (!parsed.ok) return parsed.response;
      const name = normalizeName(parsed.data.name);

      const set = await findGroupSet(courseId, setId);
      if (!set) return NextResponse.json({ error: 'Group set not found' }, { status: 404 });

      const clash = await prisma.groupSet.findFirst({
        where: { courseId, name: { equals: name, mode: 'insensitive' }, id: { not: setId } },
        select: { id: true },
      });
      if (clash) {
        return NextResponse.json(
          { error: `A group set named "${name}" already exists in this course.` },
          { status: 409 },
        );
      }

      const updated = await prisma.groupSet.update({
        where: { id: setId },
        data: { name },
        select: { id: true, name: true },
      });

      await createEnhancedActivityLog(prisma, req, {
        userId: user.id,
        action: 'UPDATE_GROUP_SET',
        severity: 'INFO',
        category: 'COURSE',
        courseId,
        metadata: { courseId, groupSetId: setId, name, previousName: set.name },
      });

      return NextResponse.json(updated);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return NextResponse.json(
          { error: 'A group set with that name already exists in this course.' },
          { status: 409 },
        );
      }
      console.error('[GROUP_SET_PATCH_ERROR]', err);
      await logError(req, {
        userId: user.id,
        action: 'GROUP_SET_UPDATE_ERROR',
        category: 'COURSE',
        error: err,
        courseId,
      });
      return NextResponse.json({ error: 'Failed to rename group set' }, { status: 500 });
    }
  },
  { access: 'manage', deniedAction: 'GROUP_SET_UPDATE_DENIED', blockWhenArchived: true },
);

/**
 * Deletes a group set and its groups + memberships (cascade). Deletion is blocked
 * when the set has dependencies (none exist yet; the assignment-integration phase
 * adds submission/grade checks). Dependencies are re-checked inside the delete
 * transaction. Course staff or admin.
 * @openapi
 * summary: Delete a group set
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 *   - { name: setId, in: path, required: true, schema: { type: string } }
 * responses:
 *   200: { description: Group set deleted. }
 *   401: { description: Not signed in. }
 *   403: { description: Not course staff or a system admin. }
 *   404: { description: Group set not found in this course. }
 *   409: { description: The group set has dependencies and cannot be deleted. }
 *   500: { description: Server error. }
 */
export const DELETE = withCourseAuth(
  async (req, ctx, { user, courseId }) => {
    const { setId } = await ctx.params;
    if (!setId) return NextResponse.json({ error: 'Missing params' }, { status: 400 });
    try {
      const set = await findGroupSet(courseId, setId);
      if (!set) return NextResponse.json({ error: 'Group set not found' }, { status: 404 });

      // Re-check dependencies inside the transaction so a concurrently-added
      // dependency can't be raced past the guard. Currently there are none.
      const blockers = groupSetDeletionBlockers();
      if (blockers.length > 0) {
        return NextResponse.json({ error: blockers.join(' ') }, { status: 409 });
      }

      await prisma.$transaction(async (tx) => {
        const stillBlocked = groupSetDeletionBlockers();
        if (stillBlocked.length > 0) throw new Error('DEP_CONFLICT');
        await tx.groupSet.delete({ where: { id: setId } });
      });

      await createEnhancedActivityLog(prisma, req, {
        userId: user.id,
        action: 'DELETE_GROUP_SET',
        severity: 'INFO',
        category: 'COURSE',
        courseId,
        metadata: { courseId, groupSetId: setId, deletedName: set.name },
      });

      return NextResponse.json({ success: true });
    } catch (err) {
      if (err instanceof Error && err.message === 'DEP_CONFLICT') {
        return NextResponse.json(
          { error: 'The group set has dependencies and cannot be deleted.' },
          { status: 409 },
        );
      }
      console.error('[GROUP_SET_DELETE_ERROR]', err);
      await logError(req, {
        userId: user.id,
        action: 'GROUP_SET_DELETE_ERROR',
        category: 'COURSE',
        error: err,
        courseId,
      });
      return NextResponse.json({ error: 'Failed to delete group set' }, { status: 500 });
    }
  },
  { access: 'manage', deniedAction: 'GROUP_SET_DELETE_DENIED', blockWhenArchived: true },
);
