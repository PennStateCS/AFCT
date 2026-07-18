import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { withCourseAuth } from '@/lib/api/with-auth';
import { readJson } from '@/lib/api/request';
import { logError } from '@/lib/api/activity';
import { DuplicateGroupSetSchema } from '@/schemas/group-set';
import { normalizeName } from '@/lib/group-sets';
import { activeStudentIds } from '@/lib/group-set-service';

/**
 * Duplicates a group set into a new, independent set in the same course. Copies
 * groups (and, optionally, current active-student memberships). Inactive students
 * and non-student roster members are never copied. Nothing else is copied
 * (no submissions, grades, feedback, assignment links, or activity). Renaming and
 * duplication stay allowed even when a set is locked. Course staff or admin.
 * @openapi
 * summary: Duplicate a group set
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 *   - { name: setId, in: path, required: true, schema: { type: string } }
 * requestBody:
 *   required: true
 *   content:
 *     application/json:
 *       schema:
 *         type: object
 *         required: [name]
 *         properties:
 *           name: { type: string }
 *           includeMemberships: { type: boolean }
 * responses:
 *   201: { description: The new group set. }
 *   400: { description: Missing or invalid name. }
 *   401: { description: Not signed in. }
 *   403: { description: Not course staff or a system admin. }
 *   404: { description: Source group set not found in this course. }
 *   409: { description: A group set with that name already exists in the course. }
 *   500: { description: Server error. }
 */
export const POST = withCourseAuth(
  async (req, ctx, { user, courseId }) => {
    const { setId } = await ctx.params;
    if (!setId) return NextResponse.json({ error: 'Missing params' }, { status: 400 });
    try {
      const parsed = await readJson(req, DuplicateGroupSetSchema);
      if (!parsed.ok) return parsed.response;
      const name = normalizeName(parsed.data.name);
      const includeMemberships = parsed.data.includeMemberships;

      const source = await prisma.groupSet.findFirst({
        where: { id: setId, courseId },
        include: {
          groups: {
            orderBy: { createdAt: 'asc' },
            include: { memberships: { select: { userId: true } } },
          },
        },
      });
      if (!source) return NextResponse.json({ error: 'Group set not found' }, { status: 404 });

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

      // When copying memberships, keep only students who are still active STUDENTs.
      let allowedUserIds = new Set<string>();
      if (includeMemberships) {
        const memberIds = source.groups.flatMap((g) =>
          (g.memberships ?? []).map((m) => m.userId),
        );
        allowedUserIds = await activeStudentIds(courseId, memberIds);
      }

      const created = await prisma.$transaction(async (tx) => {
        const newSet = await tx.groupSet.create({ data: { courseId, name } });
        for (const g of source.groups) {
          const newGroup = await tx.studentGroup.create({
            data: { groupSetId: newSet.id, name: g.name },
          });
          if (includeMemberships) {
            const rows = (g.memberships ?? [])
              .filter((m) => allowedUserIds.has(m.userId))
              .map((m) => ({
                groupSetId: newSet.id,
                groupId: newGroup.id,
                courseId,
                userId: m.userId,
              }));
            if (rows.length > 0) await tx.groupMembership.createMany({ data: rows });
          }
        }
        return newSet;
      });

      await createEnhancedActivityLog(prisma, req, {
        userId: user.id,
        action: 'DUPLICATE_GROUP_SET',
        severity: 'INFO',
        category: 'COURSE',
        courseId,
        metadata: {
          courseId,
          sourceGroupSetId: setId,
          groupSetId: created.id,
          name: created.name,
          includeMemberships,
          copiedMemberCount: includeMemberships ? allowedUserIds.size : 0,
        },
      });

      return NextResponse.json({ id: created.id, name: created.name }, { status: 201 });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return NextResponse.json(
          { error: 'A group set with that name already exists in this course.' },
          { status: 409 },
        );
      }
      console.error('[GROUP_SET_DUPLICATE_ERROR]', err);
      await logError(req, {
        userId: user.id,
        action: 'GROUP_SET_DUPLICATE_ERROR',
        category: 'COURSE',
        error: err,
        courseId,
      });
      return NextResponse.json({ error: 'Failed to duplicate group set' }, { status: 500 });
    }
  },
  { access: 'manage', deniedAction: 'GROUP_SET_DUPLICATE_DENIED', blockWhenArchived: true },
);
