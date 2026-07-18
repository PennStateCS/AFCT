import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { withCourseAuth } from '@/lib/api/with-auth';
import { readJson } from '@/lib/api/request';
import { logError } from '@/lib/api/activity';
import { CreateGroupSetSchema } from '@/schemas/group-set';
import { defaultGroupName, normalizeName } from '@/lib/group-sets';
import { loadGroupSetSummaries } from '@/lib/group-set-service';

/**
 * Lists a course's group sets with summary counts. Course staff (faculty or TAs)
 * or a system admin.
 * @openapi
 * summary: List course group sets
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 * responses:
 *   200:
 *     description: The course's group sets.
 *     content:
 *       application/json:
 *         schema: { type: array, items: { type: object } }
 *   401: { description: Not signed in. }
 *   403: { description: Not course staff or a system admin. }
 *   500: { description: Server error. }
 */
export const GET = withCourseAuth(
  async (req, _ctx, { user, courseId }) => {
    try {
      const sets = await loadGroupSetSummaries(courseId);
      return NextResponse.json(sets);
    } catch (err) {
      console.error('[GROUP_SETS_GET_ERROR]', err);
      await logError(req, {
        userId: user.id,
        action: 'GROUP_SET_LIST_ERROR',
        category: 'COURSE',
        error: err,
        courseId,
      });
      return NextResponse.json({ error: 'Failed to fetch group sets' }, { status: 500 });
    }
  },
  { access: 'manage', deniedAction: 'GROUP_SETS_VIEW_DENIED' },
);

/**
 * Creates a group set, optionally seeding a number of empty default-named groups.
 * Course staff (faculty or TAs) or a system admin. Set names are unique per course
 * (case-insensitive).
 * @openapi
 * summary: Create a course group set
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 * requestBody:
 *   required: true
 *   content:
 *     application/json:
 *       schema:
 *         type: object
 *         required: [name]
 *         properties:
 *           name: { type: string }
 *           initialGroupCount: { type: integer, minimum: 0, maximum: 50 }
 * responses:
 *   201: { description: The created group set. }
 *   400: { description: Missing or invalid name. }
 *   401: { description: Not signed in. }
 *   403: { description: Not course staff or a system admin. }
 *   409: { description: A group set with that name already exists in the course. }
 *   500: { description: Server error. }
 */
export const POST = withCourseAuth(
  async (req, _ctx, { user, courseId }) => {
    try {
      const parsed = await readJson(req, CreateGroupSetSchema);
      if (!parsed.ok) return parsed.response;
      const name = normalizeName(parsed.data.name);
      const initialGroupCount = parsed.data.initialGroupCount ?? 0;

      // Case-insensitive uniqueness with a friendly message (the DB unique index
      // is the concurrency backstop, handled by the P2002 catch below).
      const clash = await prisma.groupSet.findFirst({
        where: { courseId, name: { equals: name, mode: 'insensitive' } },
        select: { id: true },
      });
      if (clash) {
        return NextResponse.json(
          { error: `A group set named "${name}" already exists in this course.` },
          { status: 409 },
        );
      }

      const set = await prisma.groupSet.create({
        data: {
          courseId,
          name,
          groups:
            initialGroupCount > 0
              ? {
                  create: Array.from({ length: initialGroupCount }, (_, i) => ({
                    name: defaultGroupName(i + 1),
                  })),
                }
              : undefined,
        },
        select: { id: true, name: true },
      });

      await createEnhancedActivityLog(prisma, req, {
        userId: user.id,
        action: 'CREATE_GROUP_SET',
        severity: 'INFO',
        category: 'COURSE',
        courseId,
        metadata: { courseId, groupSetId: set.id, name: set.name, initialGroupCount },
      });

      return NextResponse.json(set, { status: 201 });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return NextResponse.json(
          { error: 'A group set with that name already exists in this course.' },
          { status: 409 },
        );
      }
      console.error('[GROUP_SETS_POST_ERROR]', err);
      await logError(req, {
        userId: user.id,
        action: 'GROUP_SET_CREATE_ERROR',
        category: 'COURSE',
        error: err,
        courseId,
      });
      return NextResponse.json({ error: 'Failed to create group set' }, { status: 500 });
    }
  },
  { access: 'manage', deniedAction: 'GROUP_SET_CREATE_DENIED', blockWhenArchived: true },
);
