import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';

// DELETE: remove member from group
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string; groupId: string; userId: string }> }) {
  const { id, groupId, userId } = await params;

  if (!id || !groupId || !userId) return NextResponse.json({ error: 'Missing params' }, { status: 400 });

  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!['ADMIN', 'FACULTY', 'TA'].includes(session.user.role)) {
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
      category: 'COURSE',
      metadata: { courseId: id, groupId, userId },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[GROUP_MEMBERS_DELETE_ERROR]', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
