import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { canManageCourse } from '@/lib/permissions';

/**
 * Removes a user from a group, addressed by the group's and user's global ids.
 * Staff only (ADMIN/FACULTY/TA).
 * @openapi
 * summary: Remove a group member by ids
 * parameters:
 *   - { name: gid, in: path, required: true, schema: { type: string } }
 *   - { name: uid, in: path, required: true, schema: { type: string } }
 * responses:
 *   200: { description: Member removed. }
 *   400: { description: Missing ids. }
 *   401: { description: Not signed in. }
 *   403: { description: Caller lacks a staff role. }
 *   404: { description: Group or membership not found. }
 *   500: { description: Server error. }
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ gid: string; uid: string; id?: string }> },
) {
  const { id: providedCourseId, gid: groupId, uid: userId } = await params;

  if (!groupId || !userId) return NextResponse.json({ error: 'Missing IDs' }, { status: 400 });

  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const group = await prisma.group.findUnique({ where: { id: groupId } });
    if (!group) return NextResponse.json({ error: 'Group not found' }, { status: 404 });
    if (providedCourseId && group.courseId !== providedCourseId)
      return NextResponse.json({ error: 'Group not found' }, { status: 404 });
    const courseId = group.courseId;

    if (!(await canManageCourse(session.user, courseId))) {
      await createEnhancedActivityLog(prisma, req, {
        userId: session?.user?.id ?? null,
        action: 'GROUP_MEMBER_REMOVE_DENIED',
        severity: 'SECURITY',
        metadata: {},
      });
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const entry = await prisma.groupRoster.findUnique({
      where: { groupId_userId: { groupId, userId } },
    });
    if (!entry) return NextResponse.json({ error: 'Membership not found' }, { status: 404 });

    await prisma.groupRoster.delete({ where: { id: entry.id } });

    await createEnhancedActivityLog(prisma, req, {
      userId: session.user.id,
      action: 'REMOVE_GROUP_MEMBER',
      severity: 'INFO',
      category: 'COURSE',
      metadata: { courseId, groupId, removedUserId: userId },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[GROUP_MEMBERS_DELETE_ERROR]', err);
    await createEnhancedActivityLog(prisma, req, {
      userId: session?.user?.id ?? null,
      action: 'GROUP_MEMBER_REMOVE_ERROR',
      severity: 'ERROR',
      metadata: { error: err instanceof Error ? err.message : 'unknown error' },
    });
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
