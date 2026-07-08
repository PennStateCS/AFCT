import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { withCourseAuth } from '@/lib/api/with-auth';

/**
 * Removes one member from a group. Course staff (faculty or TAs) or a system admin.
 * The group must belong to the course in the path and the membership must exist.
 * @openapi
 * summary: Remove a group member
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 *   - { name: groupId, in: path, required: true, schema: { type: string } }
 *   - { name: userId, in: path, required: true, schema: { type: string } }
 * responses:
 *   200: { description: Member removed. }
 *   401: { description: Not signed in. }
 *   403: { description: Not course staff or a system admin. }
 *   404: { description: Group or membership not found. }
 *   500: { description: Server error. }
 */
export const DELETE = withCourseAuth(
  async (req, ctx, { user, courseId }) => {
    const { groupId, userId } = await ctx.params;

    if (!groupId || !userId) {
      return NextResponse.json({ error: 'Missing params' }, { status: 400 });
    }

    try {
      // Ensure group belongs to course
      const group = await prisma.group.findUnique({ where: { id: groupId } });
      if (!group || group.courseId !== courseId) {
        return NextResponse.json({ error: 'Group not found for course' }, { status: 404 });
      }

      // Ensure membership exists
      const membership = await prisma.groupRoster.findUnique({
        where: { groupId_userId: { groupId, userId } },
      });
      if (!membership) {
        return NextResponse.json({ error: 'Membership not found' }, { status: 404 });
      }

      // Delete the group roster entry
      await prisma.groupRoster.deleteMany({ where: { groupId, userId } });

      await createEnhancedActivityLog(prisma, req, {
        userId: user.id,
        action: 'REMOVE_GROUP_MEMBER',
        severity: 'INFO',
        category: 'COURSE',
        metadata: { courseId, groupId, userId },
      });

      return NextResponse.json({ success: true });
    } catch (err) {
      console.error('[GROUP_MEMBERS_DELETE_ERROR]', err);
      await createEnhancedActivityLog(prisma, req, {
        userId: user.id,
        action: 'GROUP_MEMBER_REMOVE_ERROR',
        severity: 'ERROR',
        metadata: { error: err instanceof Error ? err.message : 'unknown error' },
      });
      return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
  },
  { access: 'manage', deniedAction: 'GROUP_MEMBER_REMOVE_DENIED' },
);
