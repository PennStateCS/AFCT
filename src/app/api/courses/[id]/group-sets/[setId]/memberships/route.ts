import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { withCourseAuth } from '@/lib/api/with-auth';
import { readJson } from '@/lib/api/request';
import { logError } from '@/lib/api/activity';
import { AssignMembershipsSchema } from '@/schemas/group-set';
import { assertGroupSetUnlocked, computeMembershipBasis, GroupSetLockedError } from '@/lib/group-sets';
import { activeStudentIds, findGroupSet, loadGroupSetDetail } from '@/lib/group-set-service';

/**
 * Atomically assigns, moves, and removes students within a group set. Each
 * operation sets one student's group (or removes them when groupId is null). A
 * move is a single upsert on the (set, student) unique key, so a student is never
 * transiently in two groups. Assign/move targets must be active STUDENTs;
 * removals are allowed even for inactive members. When expectedBasis is provided
 * and no longer matches the set's current memberships, the change is rejected with
 * 409 so a stale client cannot silently overwrite another staff member's edit.
 * Blocked when the set is locked. Course staff or admin.
 * @openapi
 * summary: Bulk change group-set memberships
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 *   - { name: setId, in: path, required: true, schema: { type: string } }
 * requestBody:
 *   required: true
 *   content:
 *     application/json:
 *       schema:
 *         type: object
 *         required: [operations]
 *         properties:
 *           operations:
 *             type: array
 *             items:
 *               type: object
 *               required: [userId, groupId]
 *               properties:
 *                 userId: { type: string }
 *                 groupId: { type: string, nullable: true }
 *           expectedBasis: { type: string }
 * responses:
 *   200: { description: The updated group set detail. }
 *   400: { description: Invalid operations or an unknown group or ineligible student. }
 *   401: { description: Not signed in. }
 *   403: { description: Not course staff or a system admin. }
 *   404: { description: Group set not found in this course. }
 *   409: { description: The set is locked or the memberships changed since expectedBasis. }
 *   500: { description: Server error. }
 */
export const POST = withCourseAuth(
  async (req, ctx, { user, courseId }) => {
    const { setId } = await ctx.params;
    if (!setId) return NextResponse.json({ error: 'Missing params' }, { status: 400 });
    try {
      const parsed = await readJson(req, AssignMembershipsSchema);
      if (!parsed.ok) return parsed.response;
      const { operations, expectedBasis } = parsed.data;

      const set = await findGroupSet(courseId, setId);
      if (!set) return NextResponse.json({ error: 'Group set not found' }, { status: 404 });
      assertGroupSetUnlocked();

      // Reject duplicate userIds so an ambiguous assign+remove can't slip through.
      const seen = new Set<string>();
      for (const op of operations) {
        if (seen.has(op.userId)) {
          return NextResponse.json(
            { error: 'Each student may appear at most once per request.' },
            { status: 400 },
          );
        }
        seen.add(op.userId);
      }

      const assigns = operations.filter((o) => o.groupId !== null) as {
        userId: string;
        groupId: string;
      }[];
      const removes = operations.filter((o) => o.groupId === null).map((o) => o.userId);

      // Validate assign targets: the group must belong to this set.
      const setGroups = await prisma.studentGroup.findMany({
        where: { groupSetId: setId },
        select: { id: true },
      });
      const validGroupIds = new Set(setGroups.map((g) => g.id));
      for (const op of assigns) {
        if (!validGroupIds.has(op.groupId)) {
          return NextResponse.json(
            { error: 'One or more groups do not belong to this set.' },
            { status: 400 },
          );
        }
      }

      // Validate assign targets: only active STUDENTs may be newly assigned/moved.
      const assignUserIds = assigns.map((a) => a.userId);
      const eligible = await activeStudentIds(courseId, assignUserIds);
      const ineligible = assignUserIds.filter((id) => !eligible.has(id));
      if (ineligible.length > 0) {
        await createEnhancedActivityLog(prisma, req, {
          userId: user.id,
          action: 'GROUP_SET_MEMBERSHIP_REJECTED',
          severity: 'WARNING',
          category: 'COURSE',
          courseId,
          metadata: { courseId, groupSetId: setId, ineligibleCount: ineligible.length },
        });
        return NextResponse.json(
          { error: 'Only active students on the roster can be assigned to a group.' },
          { status: 400 },
        );
      }

      // Optimistic concurrency: reject if the set changed since the client's basis.
      if (expectedBasis !== undefined) {
        const current = await prisma.groupMembership.findMany({
          where: { groupSetId: setId },
          select: { userId: true, groupId: true },
        });
        const currentBasis = computeMembershipBasis(current);
        if (currentBasis !== expectedBasis) {
          await createEnhancedActivityLog(prisma, req, {
            userId: user.id,
            action: 'GROUP_SET_MEMBERSHIP_CONFLICT',
            severity: 'WARNING',
            category: 'COURSE',
            courseId,
            metadata: { courseId, groupSetId: setId },
          });
          return NextResponse.json(
            {
              error:
                'This group set was changed by someone else. Refresh to see the latest groups and try again.',
            },
            { status: 409 },
          );
        }
      }

      await prisma.$transaction(async (tx) => {
        if (removes.length > 0) {
          await tx.groupMembership.deleteMany({
            where: { groupSetId: setId, userId: { in: removes } },
          });
        }
        for (const op of assigns) {
          await tx.groupMembership.upsert({
            where: { groupSetId_userId: { groupSetId: setId, userId: op.userId } },
            create: { groupSetId: setId, groupId: op.groupId, courseId, userId: op.userId },
            update: { groupId: op.groupId },
          });
        }
      });

      await createEnhancedActivityLog(prisma, req, {
        userId: user.id,
        action: 'UPDATE_GROUP_SET_MEMBERSHIPS',
        severity: 'INFO',
        category: 'COURSE',
        courseId,
        metadata: {
          courseId,
          groupSetId: setId,
          assignedCount: assigns.length,
          removedCount: removes.length,
        },
      });

      const detail = await loadGroupSetDetail(courseId, setId);
      return NextResponse.json(detail);
    } catch (err) {
      if (err instanceof GroupSetLockedError) {
        return NextResponse.json({ error: err.message }, { status: 409 });
      }
      console.error('[GROUP_SET_MEMBERSHIPS_POST_ERROR]', err);
      await logError(req, {
        userId: user.id,
        action: 'GROUP_SET_MEMBERSHIP_ERROR',
        category: 'COURSE',
        error: err,
        courseId,
      });
      return NextResponse.json({ error: 'Failed to update memberships' }, { status: 500 });
    }
  },
  { access: 'manage', deniedAction: 'GROUP_SET_MEMBERSHIP_DENIED', blockWhenArchived: true },
);
