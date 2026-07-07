import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { UpdateGroupSchema } from '@/schemas/group';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { canManageCourse } from '@/lib/permissions';

/**
 * Renames a group by its global id (the course-agnostic variant of the course-
 * scoped route). Staff only. Names remain unique within the group's course.
 * @openapi
 * summary: Rename a group by id
 * parameters:
 *   - { name: gid, in: path, required: true, schema: { type: string } }
 * requestBody:
 *   required: true
 *   content:
 *     application/json:
 *       schema: { type: object, required: [name], properties: { name: { type: string } } }
 * responses:
 *   200: { description: The updated group. }
 *   400: { description: Validation failed. }
 *   401: { description: Not signed in. }
 *   403: { description: Caller lacks a staff role. }
 *   404: { description: Group not found. }
 *   409: { description: Name already used in the course. }
 *   500: { description: Server error. }
 */
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

    if (!(await canManageCourse(session.user, courseId))) {
      await createEnhancedActivityLog(prisma, req, {
        userId: session?.user?.id ?? null,
        action: 'GROUP_UPDATE_DENIED',
        severity: 'SECURITY',
        metadata: {},
      });
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

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
      severity: 'INFO',
      category: 'COURSE',
      metadata: { courseId: courseId, groupId: gid },
    });

    return NextResponse.json(updated);
  } catch (err) {
    console.error('[COURSE_GROUP_PATCH_ERROR]', err);
    await createEnhancedActivityLog(prisma, req, {
      userId: session?.user?.id ?? null,
      action: 'GROUP_UPDATE_ERROR',
      severity: 'ERROR',
      metadata: { error: err instanceof Error ? err.message : 'unknown error' },
    });
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

/**
 * Deletes a group by its global id; membership rows cascade. Staff only.
 * @openapi
 * summary: Delete a group by id
 * parameters:
 *   - { name: gid, in: path, required: true, schema: { type: string } }
 * responses:
 *   200: { description: Group deleted. }
 *   400: { description: Missing group id. }
 *   401: { description: Not signed in. }
 *   403: { description: Caller lacks a staff role. }
 *   404: { description: Group not found. }
 *   500: { description: Server error. }
 */
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

  try {
    const group = await prisma.group.findUnique({ where: { id: gid } });
    if (!group) return NextResponse.json({ error: 'Group not found' }, { status: 404 });
    if (providedCourseId && group.courseId !== providedCourseId)
      return NextResponse.json({ error: 'Group does not belong to this course' }, { status: 400 });
    const courseId = group.courseId;

    if (!(await canManageCourse(session.user, courseId))) {
      await createEnhancedActivityLog(prisma, req, {
        userId: session?.user?.id ?? null,
        action: 'GROUP_DELETE_DENIED',
        severity: 'SECURITY',
        metadata: {},
      });
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    await prisma.group.delete({ where: { id: gid } });

    await createEnhancedActivityLog(prisma, req, {
      userId: session.user.id,
      action: 'DELETE_GROUP',
      severity: 'INFO',
      category: 'COURSE',
      metadata: { courseId, groupId: gid, deletedGroupName: group.name },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[COURSE_GROUP_DELETE_ERROR]', err);
    await createEnhancedActivityLog(prisma, req, {
      userId: session?.user?.id ?? null,
      action: 'GROUP_DELETE_ERROR',
      severity: 'ERROR',
      metadata: { error: err instanceof Error ? err.message : 'unknown error' },
    });
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
