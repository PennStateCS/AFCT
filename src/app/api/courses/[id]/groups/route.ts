import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
// GET: list groups for a course
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  if (!id) {
    return NextResponse.json({ error: 'Missing course ID' }, { status: 400 });
  }

  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Only allow faculty/ta/admin to fetch groups
  if (!['ADMIN', 'FACULTY', 'TA'].includes(session.user.role)) {
    await createEnhancedActivityLog(prisma, req, {
      userId: session?.user?.id ?? null,
      action: 'COURSE_GROUPS_VIEW_DENIED',
      severity: 'SECURITY',
      metadata: { role: session?.user?.role ?? null },
    });
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const groups = await prisma.group.findMany({
      where: { courseId: id },
      orderBy: { name: 'asc' },
    });

    await createEnhancedActivityLog(prisma, req, {
      userId: session.user.id,
      action: 'VIEW_GROUPS',
      severity: 'INFO',
      category: 'COURSE',
      metadata: { courseId: id },
    });

    return NextResponse.json(groups);
  } catch (err) {
    console.error('[COURSE_GROUPS_GET_ERROR]', err);
    return NextResponse.json({ error: 'Failed to fetch groups' }, { status: 500 });
  }
}

// POST: supports both create and "list via body" to avoid client-side use of AbortController.signal.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  if (!id) {
    return NextResponse.json({ error: 'Missing course ID' }, { status: 400 });
  }

  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!['ADMIN', 'FACULTY', 'TA'].includes(session.user.role)) {
    await createEnhancedActivityLog(prisma, req, {
      userId: session?.user?.id ?? null,
      action: 'GROUP_CREATE_DENIED',
      severity: 'SECURITY',
      metadata: { role: session?.user?.role ?? null },
    });
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const data = await req.json();

    // Support a POST body { action: 'list' } so clients don't need to use AbortController.signal
    if (data?.action === 'list') {
      try {
        const groups = await prisma.group.findMany({
          where: { courseId: id },
          orderBy: { name: 'asc' },
        });
        await createEnhancedActivityLog(prisma, req, {
          userId: session.user.id,
          action: 'VIEW_GROUPS',
          severity: 'INFO',
          category: 'COURSE',
          metadata: { courseId: id },
        });
        return NextResponse.json(groups);
      } catch (err) {
        console.error('[COURSE_GROUPS_POST_LIST_ERROR]', err);
        await createEnhancedActivityLog(prisma, req, {
          userId: session?.user?.id ?? null,
          action: 'GROUP_LIST_ERROR',
          severity: 'ERROR',
          metadata: { error: err instanceof Error ? err.message : 'unknown error' },
        });
        return NextResponse.json({ error: 'Failed to fetch groups' }, { status: 500 });
      }
    }

    // Otherwise treat as create
    const name = (data.name ?? '').trim();

    if (!name) return NextResponse.json({ error: 'Name not found' }, { status: 422 });

    // Ensure course exists
    const course = await prisma.course.findUnique({ where: { id } });
    if (!course) return NextResponse.json({ error: 'Course not found' }, { status: 404 });

    // Prevent duplicates (composite unique: [courseId, name])
    const exists = await prisma.group.findUnique({
      where: { courseId_name: { courseId: id, name } },
    });
    if (exists)
      return NextResponse.json(
        { error: 'Group name already exists for this course' },
        { status: 409 },
      );

    const group = await prisma.group.create({ data: { name, courseId: id } });

    await createEnhancedActivityLog(prisma, req, {
      userId: session.user.id,
      action: 'CREATE_GROUP',
      severity: 'INFO',
      category: 'COURSE',
      metadata: { courseId: id, groupId: group.id },
    });

    return NextResponse.json(group, { status: 201 });
  } catch (err) {
    console.error('[COURSE_GROUPS_POST_ERROR]', err);
    await createEnhancedActivityLog(prisma, req, {
      userId: session?.user?.id ?? null,
      action: 'GROUP_CREATE_ERROR',
      severity: 'ERROR',
      metadata: { error: err instanceof Error ? err.message : 'unknown error' },
    });
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
