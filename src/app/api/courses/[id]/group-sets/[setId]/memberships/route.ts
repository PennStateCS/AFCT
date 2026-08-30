import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getClientIp } from '@/lib/security/rate-limiter';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { withCourseAuth } from '@/lib/api/with-auth';
import { readJson } from '@/lib/api/request';
import { logError } from '@/lib/api/activity';
import { AssignMembershipsSchema } from '@/schemas/group-set';
import { computeMembershipBasis, GroupSetLockedError } from '@/lib/group-sets';
import {
  activeStudentIds,
  assertGroupSetUnlocked,
  findGroupSet,
  loadGroupSetDetail,
} from '@/lib/group-set-service';

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
      await assertGroupSetUnlocked(setId);

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
            metadata: {
              courseId,
              groupSetId: setId,
              reason: 'group set changed by someone else while this edit was open',
              memberCount: current.length,
            },
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

      // Where each affected student was before the edit. A move is an upsert and the request
      // carries only the destination, so the group they came out of is only knowable now, and
      // that is the half a group grade turns on. One indexed read over the affected users.
      const touched = [...new Set([...removes, ...assigns.map((op) => op.userId)])];
      const previous = new Map(
        (
          await prisma.groupMembership.findMany({
            where: { groupSetId: setId, userId: { in: touched } },
            select: { userId: true, groupId: true },
          })
        ).map((row) => [row.userId, row.groupId]),
      );

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

      /**
       * One entry per student, then the summary. The summary used to carry the moves itself,
       * capped at 100 names, so a whole-course reshuffle dropped the very thing it promised to
       * keep. These have no cap, carry the from-group, and are findable per student.
       *
       * After the commit and in one statement: a failed audit must not roll back a membership
       * change, and the usual helper costs several queries per call.
       */
      const ip = getClientIp(req);
      const userAgent = req.headers.get('user-agent') ?? null;
      const perStudent = [
        ...assigns.map((op) => ({
          action: 'GROUP_MEMBERSHIP_ASSIGNED',
          targetUserId: op.userId,
          fromGroupId: previous.get(op.userId) ?? null,
          toGroupId: op.groupId,
        })),
        ...removes.map((userId) => ({
          action: 'GROUP_MEMBERSHIP_REMOVED',
          targetUserId: userId,
          fromGroupId: previous.get(userId) ?? null,
          toGroupId: null,
        })),
      ];

      if (perStudent.length > 0) {
        // The names as well as the ids. The log read "one student, cmtf35e5j00 to
        // cmtf35e5i00", which is unreadable and, once a group is renamed, no longer resolvable
        // to what it meant at the time. The ids stay because they are what survives a rename;
        // the names are what a person can act on. One indexed read over the groups touched.
        const groupIds = [
          ...new Set(
            perStudent
              .flatMap((row) => [row.fromGroupId, row.toGroupId])
              .filter((id) => id !== null),
          ),
        ];
        const groupNames = new Map(
          (
            await prisma.studentGroup.findMany({
              where: { id: { in: groupIds } },
              select: { id: true, name: true },
            })
          ).map((group) => [group.id, group.name]),
        );
        const nameOf = (id: string | null) => (id ? (groupNames.get(id) ?? null) : null);

        await prisma.activityLog.createMany({
          data: perStudent.map(({ action, targetUserId, fromGroupId, toGroupId }) => ({
            userId: user.id,
            action,
            severity: 'INFO' as const,
            // Explicit: neither name contains a word the category would be inferred from.
            category: 'COURSE' as const,
            courseId,
            ipAddress: ip,
            userAgent,
            metadata: {
              targetUserId,
              groupSetId: setId,
              fromGroupId,
              toGroupId,
              fromGroupName: nameOf(fromGroupId),
              toGroupName: nameOf(toGroupId),
            },
          })),
        });
      }

      await createEnhancedActivityLog(prisma, req, {
        userId: user.id,
        action: 'UPDATE_GROUP_SET_MEMBERSHIPS',
        severity: 'INFO',
        category: 'COURSE',
        courseId,
        metadata: {
          courseId,
          groupSetId: setId,
          // Counts only. Who moved, and out of which group, is now a row per student above,
          // which is both uncapped and findable; keeping a truncated copy here as well would
          // be a second version of the truth that disagrees with the first past 100 names.
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
