import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { withCourseAuth } from '@/lib/api/with-auth';
import { readJson } from '@/lib/api/request';
import { logError } from '@/lib/api/activity';
import { GroupNameBodySchema } from '@/schemas/group-set';
import { normalizeName, GroupSetLockedError } from '@/lib/group-sets';
import { assertGroupSetUnlocked } from '@/lib/group-set-service';

/** Loads a group and confirms it belongs to the given set and course. */
function findGroupInSet(courseId: string, setId: string, groupId: string) {
  return prisma.studentGroup.findFirst({
    where: { id: groupId, groupSetId: setId, groupSet: { courseId } },
    select: { id: true, name: true },
  });
}

/**
 * Renames a group within its set (unique per set, case-insensitive). Course staff
 * or admin.
 * @openapi
 * summary: Rename a group in a set
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 *   - { name: setId, in: path, required: true, schema: { type: string } }
 *   - { name: groupId, in: path, required: true, schema: { type: string } }
 * requestBody:
 *   required: true
 *   content:
 *     application/json:
 *       schema: { type: object, required: [name], properties: { name: { type: string } } }
 * responses:
 *   200: { description: The updated group. }
 *   400: { description: Missing or invalid name. }
 *   401: { description: Not signed in. }
 *   403: { description: Not course staff or a system admin. }
 *   404: { description: Group not found in this set. }
 *   409: { description: Name already used by another group in the set. }
 *   500: { description: Server error. }
 */
export const PATCH = withCourseAuth(
  async (req, ctx, { user, courseId }) => {
    const { setId, groupId } = await ctx.params;
    if (!setId || !groupId) return NextResponse.json({ error: 'Missing params' }, { status: 400 });
    try {
      const parsed = await readJson(req, GroupNameBodySchema);
      if (!parsed.ok) return parsed.response;
      const name = normalizeName(parsed.data.name);

      const group = await findGroupInSet(courseId, setId, groupId);
      if (!group) return NextResponse.json({ error: 'Group not found' }, { status: 404 });

      const clash = await prisma.studentGroup.findFirst({
        where: { groupSetId: setId, name: { equals: name, mode: 'insensitive' }, id: { not: groupId } },
        select: { id: true },
      });
      if (clash) {
        return NextResponse.json(
          { error: `A group named "${name}" already exists in this set.` },
          { status: 409 },
        );
      }

      const updated = await prisma.studentGroup.update({
        where: { id: groupId },
        data: { name },
        select: { id: true, name: true },
      });

      await createEnhancedActivityLog(prisma, req, {
        userId: user.id,
        action: 'UPDATE_GROUP_SET_GROUP',
        severity: 'INFO',
        category: 'COURSE',
        courseId,
        metadata: { courseId, groupSetId: setId, groupId, name, previousName: group.name },
      });

      return NextResponse.json(updated);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return NextResponse.json(
          { error: 'A group with that name already exists in this set.' },
          { status: 409 },
        );
      }
      console.error('[GROUP_SET_GROUP_PATCH_ERROR]', err);
      await logError(req, {
        userId: user.id,
        action: 'GROUP_SET_GROUP_UPDATE_ERROR',
        category: 'COURSE',
        error: err,
        courseId,
      });
      return NextResponse.json({ error: 'Failed to rename group' }, { status: 500 });
    }
  },
  { access: 'manage', deniedAction: 'GROUP_SET_GROUP_UPDATE_DENIED', blockWhenArchived: true },
);

/**
 * Deletes a group (its memberships cascade away). Blocked when the set is locked.
 * Course staff or admin.
 * @openapi
 * summary: Delete a group in a set
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 *   - { name: setId, in: path, required: true, schema: { type: string } }
 *   - { name: groupId, in: path, required: true, schema: { type: string } }
 * responses:
 *   200: { description: Group deleted. }
 *   401: { description: Not signed in. }
 *   403: { description: Not course staff or a system admin. }
 *   404: { description: Group not found in this set. }
 *   409: { description: The set is locked. }
 *   500: { description: Server error. }
 */
export const DELETE = withCourseAuth(
  async (req, ctx, { user, courseId }) => {
    const { setId, groupId } = await ctx.params;
    if (!setId || !groupId) return NextResponse.json({ error: 'Missing params' }, { status: 400 });
    try {
      const group = await findGroupInSet(courseId, setId, groupId);
      if (!group) return NextResponse.json({ error: 'Group not found' }, { status: 404 });
      await assertGroupSetUnlocked(setId);

      await prisma.studentGroup.delete({ where: { id: groupId } });

      await createEnhancedActivityLog(prisma, req, {
        userId: user.id,
        action: 'DELETE_GROUP_SET_GROUP',
        severity: 'INFO',
        category: 'COURSE',
        courseId,
        metadata: { courseId, groupSetId: setId, groupId, deletedName: group.name },
      });

      return NextResponse.json({ success: true });
    } catch (err) {
      if (err instanceof GroupSetLockedError) {
        return NextResponse.json({ error: err.message }, { status: 409 });
      }
      console.error('[GROUP_SET_GROUP_DELETE_ERROR]', err);
      await logError(req, {
        userId: user.id,
        action: 'GROUP_SET_GROUP_DELETE_ERROR',
        category: 'COURSE',
        error: err,
        courseId,
      });
      return NextResponse.json({ error: 'Failed to delete group' }, { status: 500 });
    }
  },
  { access: 'manage', deniedAction: 'GROUP_SET_GROUP_DELETE_DENIED', blockWhenArchived: true },
);
