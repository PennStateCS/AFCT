import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { canManageCourse } from '@/lib/permissions';

/**
 * Lists a group's members (with user profiles) by the group's global id. Staff
 * only (ADMIN/FACULTY/TA).
 * @openapi
 * summary: List group members by group id
 * parameters:
 *   - { name: gid, in: path, required: true, schema: { type: string } }
 * responses:
 *   200:
 *     description: The group's members with profiles.
 *     content:
 *       application/json:
 *         schema: { type: object, properties: { members: { type: array, items: { type: object } } } }
 *   400: { description: Missing group id. }
 *   401: { description: Not signed in. }
 *   403: { description: Caller lacks a staff role. }
 *   404: { description: Group not found. }
 *   500: { description: Server error. }
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ gid: string; id?: string }> },
) {
  const { id: providedCourseId, gid: groupId } = await params;

  if (!groupId) return NextResponse.json({ error: 'Missing group ID' }, { status: 400 });

  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const group = await prisma.group.findUnique({ where: { id: groupId } });
    if (!group) return NextResponse.json({ error: 'Group not found' }, { status: 404 });
    if (providedCourseId && group.courseId !== providedCourseId)
      return NextResponse.json({ error: 'Group not found' }, { status: 404 });

    if (!(await canManageCourse(session.user, group.courseId))) {
      await createEnhancedActivityLog(prisma, req, {
        userId: session?.user?.id ?? null,
        action: 'GROUP_MEMBERS_VIEW_DENIED',
        severity: 'SECURITY',
        metadata: {},
      });
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const members = await prisma.groupRoster.findMany({
      where: { groupId },
      include: { user: true },
      orderBy: { createdAt: 'asc' },
    });

    const payload = members.map((m) => ({
      userId: m.userId,
      id: m.id,
      addedAt: m.createdAt,
      user: {
        id: m.user.id,
        firstName: m.user.firstName,
        lastName: m.user.lastName,
        email: m.user.email,
        avatar: m.user.avatar,
      },
    }));

    return NextResponse.json({ members: payload });
  } catch (err) {
    console.error('[GROUP_MEMBERS_GET_ERROR]', err);
    return NextResponse.json({ error: 'Failed to fetch members' }, { status: 500 });
  }
}

/**
 * Adds a member to a group by the group's global id. Staff only. Accepts either a
 * `userId` or an `email` to identify the user, who must be enrolled in the group's
 * course and not already a member.
 * @openapi
 * summary: Add a group member by group id
 * parameters:
 *   - { name: gid, in: path, required: true, schema: { type: string } }
 * requestBody:
 *   required: true
 *   content:
 *     application/json:
 *       schema:
 *         type: object
 *         properties:
 *           userId: { type: string, description: Provide this or email }
 *           email: { type: string, description: Provide this or userId }
 * responses:
 *   201: { description: Member added. }
 *   401: { description: Not signed in. }
 *   403: { description: Caller lacks a staff role. }
 *   404: { description: Group or user not found. }
 *   409: { description: User is already in the group. }
 *   422: { description: User is not enrolled in the course. }
 *   500: { description: Server error. }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ gid: string; id?: string }> },
) {
  const { id: providedCourseId, gid: groupId } = await params;

  if (!groupId) return NextResponse.json({ error: 'Missing group ID' }, { status: 400 });

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
        action: 'GROUP_MEMBER_ADD_DENIED',
        severity: 'SECURITY',
        metadata: {},
      });
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const userId = body?.userId ?? null;
    const email = body?.email ?? null;

    let user = null;
    if (userId) user = await prisma.user.findUnique({ where: { id: userId } });
    else if (email) user = await prisma.user.findUnique({ where: { email } });

    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    // Ensure user is enrolled in course
    const enrollment = await prisma.roster.findFirst({ where: { courseId, userId: user.id } });
    if (!enrollment)
      return NextResponse.json({ error: 'User is not enrolled in this course' }, { status: 422 });

    // Prevent duplicates
    const exists = await prisma.groupRoster.findUnique({
      where: { groupId_userId: { groupId, userId: user.id } },
    });
    if (exists)
      return NextResponse.json({ error: 'User is already in this group' }, { status: 409 });

    const created = await prisma.groupRoster.create({
      data: { groupId, userId: user.id, courseId },
    });

    await createEnhancedActivityLog(prisma, req, {
      userId: session.user.id,
      action: 'ADD_GROUP_MEMBER',
      severity: 'INFO',
      category: 'COURSE',
      metadata: { courseId, groupId, addedUserId: user.id },
    });

    return NextResponse.json({ member: { id: created.id, userId: user.id } }, { status: 201 });
  } catch (err) {
    console.error('[GROUP_MEMBERS_POST_ERROR]', err);
    await createEnhancedActivityLog(prisma, req, {
      userId: session?.user?.id ?? null,
      action: 'GROUP_MEMBER_ADD_ERROR',
      severity: 'ERROR',
      metadata: { error: err instanceof Error ? err.message : 'unknown error' },
    });
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
