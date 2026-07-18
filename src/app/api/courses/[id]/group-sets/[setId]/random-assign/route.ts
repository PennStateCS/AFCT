import { NextResponse } from 'next/server';
import { withCourseAuth } from '@/lib/api/with-auth';
import { readJson } from '@/lib/api/request';
import { logError } from '@/lib/api/activity';
import { RandomAssignPreviewSchema } from '@/schemas/group-set';
import { GroupSetLockedError, planRandomAssignment } from '@/lib/group-sets';
import { assertGroupSetUnlocked } from '@/lib/group-set-service';
import {
  activeStudentIds,
  findGroupSet,
  loadGroupSetDetail,
  type GroupMemberDTO,
} from '@/lib/group-set-service';

/**
 * Computes a balanced random-assignment PREVIEW without writing anything. The
 * client shows the preview, then applies it by POSTing the returned operations to
 * the memberships endpoint together with `basis` as expectedBasis (so a change by
 * another staff member since the preview is caught). Never creates groups: a set
 * with no groups returns 400. Blocked when the set is locked. Course staff or admin.
 * @openapi
 * summary: Preview a random group assignment
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 *   - { name: setId, in: path, required: true, schema: { type: string } }
 * requestBody:
 *   required: true
 *   content:
 *     application/json:
 *       schema:
 *         type: object
 *         required: [studentIds]
 *         properties:
 *           studentIds: { type: array, items: { type: string } }
 *           reassignSelected: { type: boolean }
 * responses:
 *   200: { description: The preview groups plus operations and a basis token. }
 *   400: { description: The set has no groups. }
 *   401: { description: Not signed in. }
 *   403: { description: Not course staff or a system admin. }
 *   404: { description: Group set not found in this course. }
 *   409: { description: The set is locked. }
 *   500: { description: Server error. }
 */
export const POST = withCourseAuth(
  async (req, ctx, { user, courseId }) => {
    const { setId } = await ctx.params;
    if (!setId) return NextResponse.json({ error: 'Missing params' }, { status: 400 });
    try {
      const parsed = await readJson(req, RandomAssignPreviewSchema);
      if (!parsed.ok) return parsed.response;
      const { studentIds, reassignSelected } = parsed.data;

      const set = await findGroupSet(courseId, setId);
      if (!set) return NextResponse.json({ error: 'Group set not found' }, { status: 404 });
      await assertGroupSetUnlocked(setId);

      const detail = await loadGroupSetDetail(courseId, setId);
      if (!detail) return NextResponse.json({ error: 'Group set not found' }, { status: 404 });
      if (detail.groups.length === 0) {
        return NextResponse.json(
          { error: 'Add at least one group before assigning students randomly.' },
          { status: 400 },
        );
      }

      // Current membership map + a name lookup covering current members (incl.
      // inactive) and every eligible student.
      const currentByUser = new Map<string, string>();
      const infoById = new Map<string, GroupMemberDTO>();
      for (const g of detail.groups) {
        for (const m of g.members) {
          currentByUser.set(m.id, g.id);
          infoById.set(m.id, m);
        }
      }
      for (const s of detail.eligibleStudents) {
        if (!infoById.has(s.id)) infoById.set(s.id, { ...s, inactive: false });
      }

      const eligibleActiveIds = await activeStudentIds(courseId, studentIds);
      const plan = planRandomAssignment({
        groups: detail.groups.map((g) => ({ id: g.id })),
        currentByUser,
        selectedStudentIds: studentIds,
        eligibleActiveIds,
        reassignSelected,
      });

      // Apply the plan to a copy to produce the previewed groups.
      const resultByUser = new Map(currentByUser);
      for (const op of plan.operations) resultByUser.set(op.userId, op.groupId);

      const membersByGroup = new Map<string, GroupMemberDTO[]>(
        detail.groups.map((g) => [g.id, []]),
      );
      for (const [userId, groupId] of resultByUser) {
        const info = infoById.get(userId);
        if (info) membersByGroup.get(groupId)?.push(info);
      }
      const previewGroups = detail.groups.map((g) => {
        const members = (membersByGroup.get(g.id) ?? []).slice();
        members.sort((a, b) =>
          `${a.lastName ?? ''} ${a.firstName ?? ''}`.localeCompare(
            `${b.lastName ?? ''} ${b.firstName ?? ''}`,
          ),
        );
        return { id: g.id, name: g.name, members };
      });

      return NextResponse.json({
        groups: previewGroups,
        operations: plan.operations,
        basis: detail.basis,
        skippedInactive: plan.skippedInactive,
        placedCount: plan.operations.length,
      });
    } catch (err) {
      if (err instanceof GroupSetLockedError) {
        return NextResponse.json({ error: err.message }, { status: 409 });
      }
      console.error('[GROUP_SET_RANDOM_ASSIGN_ERROR]', err);
      await logError(req, {
        userId: user.id,
        action: 'GROUP_SET_RANDOM_ASSIGN_ERROR',
        category: 'COURSE',
        error: err,
        courseId,
      });
      return NextResponse.json({ error: 'Failed to compute assignment' }, { status: 500 });
    }
  },
  { access: 'manage', deniedAction: 'GROUP_SET_RANDOM_ASSIGN_DENIED', blockWhenArchived: true },
);
