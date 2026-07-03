import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';

// GET members for a group
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string; groupId: string }> }) {
  const { id, groupId } = await params;

  if (!id || !groupId) return NextResponse.json({ error: 'Missing params' }, { status: 400 });

  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!['ADMIN', 'FACULTY', 'TA'].includes(session.user.role)) {
    await createEnhancedActivityLog(prisma, req, {
      userId: session?.user?.id ?? null,
      action: 'GROUP_MEMBERS_VIEW_DENIED',
      severity: 'SECURITY',
      metadata: { role: session?.user?.role ?? null },
    });
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    // Ensure group exists and belongs to the course
    const group = await prisma.group.findUnique({ where: { id: groupId } });
    if (!group || group.courseId !== id) return NextResponse.json({ error: 'Group not found for course' }, { status: 404 });

    const members = await prisma.groupRoster.findMany({ where: { groupId }, orderBy: { createdAt: 'asc' } });

    await createEnhancedActivityLog(prisma, req, {
      userId: session.user.id,
      action: 'VIEW_GROUP_MEMBERS',
      severity: 'INFO',
      category: 'COURSE',
      metadata: { courseId: id, groupId },
    });

    return NextResponse.json({ members });
  } catch (err) {
    console.error('[GROUP_MEMBERS_GET_ERROR]', err);
    return NextResponse.json({ error: 'Failed to fetch members' }, { status: 500 });
  }
}

// POST: add member to group
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; groupId: string }> }) {
  const { id, groupId } = await params;

  if (!id || !groupId) return NextResponse.json({ error: 'Missing params' }, { status: 400 });

  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!['ADMIN', 'FACULTY', 'TA'].includes(session.user.role)) {
    await createEnhancedActivityLog(prisma, req, {
      userId: session?.user?.id ?? null,
      action: 'GROUP_MEMBER_ADD_DENIED',
      severity: 'SECURITY',
      metadata: { role: session?.user?.role ?? null },
    });
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const userId = (body.userId ?? '').trim();
    if (!userId) return NextResponse.json({ error: 'Missing userId' }, { status: 422 });

    // Ensure group + course consistency
    const group = await prisma.group.findUnique({ where: { id: groupId } });
    if (!group || group.courseId !== id) return NextResponse.json({ error: 'Group not found for course' }, { status: 404 });

    // Ensure user exists and is enrolled in the course
    const rosterEntry = await prisma.roster.findUnique({ where: { courseId_userId: { courseId: id, userId } } });
    if (!rosterEntry) return NextResponse.json({ error: 'User is not enrolled in course' }, { status: 422 });

    // Create or update group roster entry (skip duplicates)
    await prisma.groupRoster.upsert({
      where: { groupId_userId: { groupId, userId } },
      create: { courseId: id, groupId, userId },
      update: {},
    });

    await createEnhancedActivityLog(prisma, req, {
      userId: session.user.id,
      action: 'ADD_GROUP_MEMBER',
      severity: 'INFO',
      category: 'COURSE',
      metadata: { courseId: id, groupId, userId },
    });

    return NextResponse.json({ success: true }, { status: 201 });
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

// PATCH: set group members in bulk (members: string[])
export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string; groupId: string }> }) {
  const { id, groupId } = await context.params;

  try {
    const session = await auth();
    const currentUser = session?.user;
    if (!currentUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = (await req.json()) as { members?: unknown };
    const members = Array.isArray(body?.members) ? (body.members as unknown[]).map(String) : null;
    if (!members) return NextResponse.json({ error: 'Missing members array' }, { status: 422 });

    // Check permissions: site admin or course staff (ADMIN/FACULTY/TA) in the course
    const currentRoster = await prisma.roster.findFirst({ where: { courseId: id, userId: currentUser.id } });
    const isAllowed = currentUser.role === 'ADMIN' || ['ADMIN', 'FACULTY', 'TA'].includes(currentRoster?.role ?? '');
    if (!isAllowed) {
      await createEnhancedActivityLog(prisma, req as unknown as Request, {
        userId: currentUser?.id ?? null,
        action: 'GROUP_MEMBERS_UPDATE_DENIED',
        severity: 'SECURITY',
        metadata: { role: currentUser?.role ?? null },
      });
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Ensure group exists and belongs to course
    const group = await prisma.group.findUnique({ where: { id: groupId } });
    if (!group || group.courseId !== id) return NextResponse.json({ error: 'Group not found for course' }, { status: 404 });

    // Validate that all member userIds are enrolled in course
    if (members.length > 0) {
      const rosterEntries = await prisma.roster.findMany({ where: { courseId: id, userId: { in: members } }, select: { userId: true } });
      const enrolledSet = new Set(rosterEntries.map((r) => r.userId));
      const invalid = members.filter((m) => !enrolledSet.has(m));
      if (invalid.length > 0) return NextResponse.json({ error: 'Some users are not enrolled in course', invalid }, { status: 422 });
    }

    // Compute adds/removes
    const existing = await prisma.groupRoster.findMany({ where: { groupId }, select: { userId: true } });
    const existingSet = new Set(existing.map((e) => e.userId));
    const desiredSet = new Set(members);

    const toAdd = members.filter((m) => !existingSet.has(m));
    const toRemove = existing.map((e) => e.userId).filter((u) => !desiredSet.has(u));

    // Apply changes
    if (toAdd.length > 0) {
      const data = toAdd.map((userId) => ({ groupId, courseId: id, userId }));
      await prisma.groupRoster.createMany({ data, skipDuplicates: true });
    }

    if (toRemove.length > 0) {
      await prisma.groupRoster.deleteMany({ where: { groupId, userId: { in: toRemove } } });
    }

    await createEnhancedActivityLog(prisma, req as unknown as Request, {
      userId: currentUser.id,
      action: 'SET_GROUP_MEMBERS',
      severity: 'INFO',
      category: 'COURSE',
      metadata: { courseId: id, groupId, added: toAdd, removed: toRemove },
    });

    return NextResponse.json({ success: true, added: toAdd, removed: toRemove });
  } catch (err) {
    console.error('PATCH /api/courses/[id]/groups/[groupId]/members error:', err);
    await createEnhancedActivityLog(prisma, req as unknown as Request, {
      userId: null,
      action: 'GROUP_MEMBERS_UPDATE_ERROR',
      severity: 'ERROR',
      metadata: { error: err instanceof Error ? err.message : 'unknown error' },
    });
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
