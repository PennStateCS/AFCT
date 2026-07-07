import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { canManageCourse } from '@/lib/permissions';

/**
 * Removes one member from a group. Staff only (ADMIN/FACULTY/TA). The group must
 * belong to the course in the path and the membership must exist.
 * @openapi
 * summary: Remove a group member
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 *   - { name: groupId, in: path, required: true, schema: { type: string } }
 *   - { name: userId, in: path, required: true, schema: { type: string } }
 * responses:
 *   200: { description: Member removed. }
 *   401: { description: Not signed in. }
 *   403: { description: Caller lacks a staff role. }
 *   404: { description: Group or membership not found. }
 *   500: { description: Server error. }
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string; groupId: string; userId: string }> }) {
  const { id, groupId, userId } = await params;

  if (!id || !groupId || !userId) return NextResponse.json({ error: 'Missing params' }, { status: 400 });

  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!(await canManageCourse(session.user, id))) {
    await createEnhancedActivityLog(prisma, req, {
      userId: session?.user?.id ?? null,
      action: 'GROUP_MEMBER_REMOVE_DENIED',
      severity: 'SECURITY',
      metadata: {},
    });
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    // Ensure group belongs to course
    const group = await prisma.group.findUnique({ where: { id: groupId } });
    if (!group || group.courseId !== id) return NextResponse.json({ error: 'Group not found for course' }, { status: 404 });

    // Ensure membership exists
    const membership = await prisma.groupRoster.findUnique({ where: { groupId_userId: { groupId, userId } } });
    if (!membership) return NextResponse.json({ error: 'Membership not found' }, { status: 404 });

    // Delete the group roster entry
    await prisma.groupRoster.deleteMany({ where: { groupId, userId } });

    await createEnhancedActivityLog(prisma, req, {
      userId: session.user.id,
      action: 'REMOVE_GROUP_MEMBER',
      severity: 'INFO',
      category: 'COURSE',
      metadata: { courseId: id, groupId, userId },
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
