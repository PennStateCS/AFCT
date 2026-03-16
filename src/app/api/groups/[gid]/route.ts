import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { UpdateGroupSchema } from '@/schemas/group';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';

// PATCH: update group name
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ gid: string; id?: string }> },
) {
  const { id: providedCourseId, gid } = await params;

  if (!gid) {
    return NextResponse.json({ error: 'Missing group ID' }, { status: 400 });
  }

  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!['ADMIN', 'FACULTY', 'TA'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const parsed = UpdateGroupSchema.safeParse(body);
    if (!parsed.success)
      return NextResponse.json(
        { error: parsed.error.errors.map((e) => e.message).join(', ') },
        { status: 400 },
      );

    const { name } = parsed.data;

    const group = await prisma.group.findUnique({ where: { id: gid } });
    if (!group) return NextResponse.json({ error: 'Group not found' }, { status: 404 });
    if (providedCourseId && group.courseId !== providedCourseId)
      return NextResponse.json({ error: 'Group does not belong to this course' }, { status: 400 });
    const courseId = group.courseId;

    // check unique constraint
    const exists = await prisma.group.findUnique({ where: { courseId_name: { courseId, name } } });
    if (exists && exists.id !== gid)
      return NextResponse.json(
        { error: 'Group name already exists for this course' },
        { status: 409 },
      );

    const updated = await prisma.group.update({ where: { id: gid }, data: { name } });

    await createEnhancedActivityLog(prisma, req, {
      userId: session.user.id,
      action: 'UPDATE_GROUP',
      category: 'COURSE',
      metadata: { courseId: courseId, groupId: gid },
    });

    return NextResponse.json(updated);
  } catch (err) {
    console.error('[COURSE_GROUP_PATCH_ERROR]', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

// DELETE: remove group
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ gid: string; id?: string }> },
) {
  const { id: providedCourseId, gid } = await params;

  if (!gid) {
    return NextResponse.json({ error: 'Missing group ID' }, { status: 400 });
  }

  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!['ADMIN', 'FACULTY', 'TA'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const group = await prisma.group.findUnique({ where: { id: gid } });
    if (!group) return NextResponse.json({ error: 'Group not found' }, { status: 404 });
    if (providedCourseId && group.courseId !== providedCourseId)
      return NextResponse.json({ error: 'Group does not belong to this course' }, { status: 400 });
    const courseId = group.courseId;

    await prisma.group.delete({ where: { id: gid } });

    await createEnhancedActivityLog(prisma, req, {
      userId: session.user.id,
      action: 'DELETE_GROUP',
      category: 'COURSE',
      metadata: { courseId, groupId: gid },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[COURSE_GROUP_DELETE_ERROR]', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
