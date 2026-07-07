import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { canManageCourse } from '@/lib/permissions';

/**
 * CORS preflight handler.
 * @openapi
 * summary: CORS preflight
 * responses:
 *   204: { description: No content. }
 */
export async function OPTIONS() {
  return new NextResponse(null, { status: 204 });
}

/**
 * Renames a group. Staff only (ADMIN/FACULTY/TA). The group must belong to the
 * course in the path, and the new name must be unique within that course.
 * @openapi
 * summary: Rename a group
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 *   - { name: groupId, in: path, required: true, schema: { type: string } }
 * requestBody:
 *   required: true
 *   content:
 *     application/json:
 *       schema: { type: object, required: [name], properties: { name: { type: string } } }
 * responses:
 *   200: { description: The updated group. }
 *   401: { description: Not signed in. }
 *   403: { description: Caller lacks a staff role. }
 *   404: { description: Group not found in this course. }
 *   409: { description: Name already used by another group in the course. }
 *   422: { description: Missing name. }
 *   500: { description: Server error. }
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; groupId: string }> },
) {
  const { id, groupId } = await params;

  if (!id || !groupId) return NextResponse.json({ error: 'Missing params' }, { status: 400 });

  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!(await canManageCourse(session.user, id))) {
    await createEnhancedActivityLog(prisma, req, {
      userId: session?.user?.id ?? null,
      action: 'GROUP_UPDATE_DENIED',
      severity: 'SECURITY',
      metadata: { role: session?.user?.role ?? null },
    });
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const name = (body.name ?? '').trim();
    if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 422 });

    // Ensure group exists and belongs to course
    const group = await prisma.group.findUnique({ where: { id: groupId } });
    if (!group || group.courseId !== id)
      return NextResponse.json({ error: 'Group not found for course' }, { status: 404 });

    // Prevent duplicate names for the same course
    const exists = await prisma.group.findUnique({
      where: { courseId_name: { courseId: id, name } },
    });
    if (exists && exists.id !== groupId)
      return NextResponse.json(
        { error: 'Group name already exists for this course' },
        { status: 409 },
      );

    const updated = await prisma.group.update({ where: { id: groupId }, data: { name } });

    await createEnhancedActivityLog(prisma, req, {
      userId: session.user.id,
      action: 'UPDATE_GROUP',
      severity: 'INFO',
      category: 'COURSE',
      metadata: { courseId: id, groupId, name },
    });

    return NextResponse.json(updated);
  } catch (err) {
    console.error('[GROUP_UPDATE_ERROR]', err);
    await createEnhancedActivityLog(prisma, req, {
      userId: session?.user?.id ?? null,
      action: 'GROUP_UPDATE_ERROR',
      severity: 'ERROR',
      metadata: { error: err instanceof Error ? err.message : 'unknown error' },
    });
    return NextResponse.json({ error: 'Failed to update group' }, { status: 500 });
  }
}

/**
 * Deletes a group; its membership rows cascade away with it. Staff only. The group
 * must belong to the course in the path.
 * @openapi
 * summary: Delete a group
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 *   - { name: groupId, in: path, required: true, schema: { type: string } }
 * responses:
 *   200: { description: Group deleted. }
 *   401: { description: Not signed in. }
 *   403: { description: Caller lacks a staff role. }
 *   404: { description: Group not found in this course. }
 *   500: { description: Server error. }
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; groupId: string }> },
) {
  const { id, groupId } = await params;

  if (!id || !groupId) return NextResponse.json({ error: 'Missing params' }, { status: 400 });

  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!(await canManageCourse(session.user, id))) {
    await createEnhancedActivityLog(prisma, req, {
      userId: session?.user?.id ?? null,
      action: 'GROUP_DELETE_DENIED',
      severity: 'SECURITY',
      metadata: { role: session?.user?.role ?? null },
    });
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    // Ensure group exists and belongs to course
    const group = await prisma.group.findUnique({ where: { id: groupId } });
    if (!group || group.courseId !== id)
      return NextResponse.json({ error: 'Group not found for course' }, { status: 404 });

    await prisma.group.delete({ where: { id: groupId } });

    await createEnhancedActivityLog(prisma, req, {
      userId: session.user.id,
      action: 'DELETE_GROUP',
      severity: 'INFO',
      category: 'COURSE',
      metadata: { courseId: id, groupId, deletedGroupName: group.name },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[GROUP_DELETE_ERROR]', err);
    await createEnhancedActivityLog(prisma, req, {
      userId: session?.user?.id ?? null,
      action: 'GROUP_DELETE_ERROR',
      severity: 'ERROR',
      metadata: { error: err instanceof Error ? err.message : 'unknown error' },
    });
    return NextResponse.json({ error: 'Failed to delete group' }, { status: 500 });
  }
}
