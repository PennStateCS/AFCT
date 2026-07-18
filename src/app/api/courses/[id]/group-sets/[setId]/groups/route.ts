import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { withCourseAuth } from '@/lib/api/with-auth';
import { readJson } from '@/lib/api/request';
import { logError } from '@/lib/api/activity';
import { GroupNameBodySchema } from '@/schemas/group-set';
import { normalizeName, assertGroupSetUnlocked, GroupSetLockedError } from '@/lib/group-sets';
import { findGroupSet } from '@/lib/group-set-service';

/**
 * Creates a group inside a set. Blocked when the set is locked. Group names are
 * unique within their set (case-insensitive); different sets may reuse names.
 * Course staff or admin.
 * @openapi
 * summary: Create a group in a set
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 *   - { name: setId, in: path, required: true, schema: { type: string } }
 * requestBody:
 *   required: true
 *   content:
 *     application/json:
 *       schema: { type: object, required: [name], properties: { name: { type: string } } }
 * responses:
 *   201: { description: The created group. }
 *   400: { description: Missing or invalid name. }
 *   401: { description: Not signed in. }
 *   403: { description: Not course staff or a system admin. }
 *   404: { description: Group set not found in this course. }
 *   409: { description: Duplicate group name in the set or the set is locked. }
 *   500: { description: Server error. }
 */
export const POST = withCourseAuth(
  async (req, ctx, { user, courseId }) => {
    const { setId } = await ctx.params;
    if (!setId) return NextResponse.json({ error: 'Missing params' }, { status: 400 });
    try {
      const parsed = await readJson(req, GroupNameBodySchema);
      if (!parsed.ok) return parsed.response;
      const name = normalizeName(parsed.data.name);

      const set = await findGroupSet(courseId, setId);
      if (!set) return NextResponse.json({ error: 'Group set not found' }, { status: 404 });
      assertGroupSetUnlocked();

      const clash = await prisma.studentGroup.findFirst({
        where: { groupSetId: setId, name: { equals: name, mode: 'insensitive' } },
        select: { id: true },
      });
      if (clash) {
        return NextResponse.json(
          { error: `A group named "${name}" already exists in this set.` },
          { status: 409 },
        );
      }

      const group = await prisma.studentGroup.create({
        data: { groupSetId: setId, name },
        select: { id: true, name: true },
      });

      await createEnhancedActivityLog(prisma, req, {
        userId: user.id,
        action: 'CREATE_GROUP_SET_GROUP',
        severity: 'INFO',
        category: 'COURSE',
        courseId,
        metadata: { courseId, groupSetId: setId, groupId: group.id, name: group.name },
      });

      return NextResponse.json(group, { status: 201 });
    } catch (err) {
      if (err instanceof GroupSetLockedError) {
        return NextResponse.json({ error: err.message }, { status: 409 });
      }
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return NextResponse.json(
          { error: 'A group with that name already exists in this set.' },
          { status: 409 },
        );
      }
      console.error('[GROUP_SET_GROUP_POST_ERROR]', err);
      await logError(req, {
        userId: user.id,
        action: 'GROUP_SET_GROUP_CREATE_ERROR',
        category: 'COURSE',
        error: err,
        courseId,
      });
      return NextResponse.json({ error: 'Failed to create group' }, { status: 500 });
    }
  },
  { access: 'manage', deniedAction: 'GROUP_SET_GROUP_CREATE_DENIED', blockWhenArchived: true },
);
