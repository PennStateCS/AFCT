import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { canManageCourse } from '@/lib/permissions';

/**
 * Lists a course's groups, alphabetically. Course staff (faculty or TAs) or a
 * system admin.
 * @openapi
 * summary: List course groups
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 * responses:
 *   200:
 *     description: The course's groups.
 *     content:
 *       application/json:
 *         schema: { type: array, items: { type: object } }
 *   401: { description: Not signed in. }
 *   403: { description: Not course staff or a system admin. }
 *   500: { description: Server error. }
 */
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
  if (!(await canManageCourse(session.user, id))) {
    await createEnhancedActivityLog(prisma, req, {
      userId: session?.user?.id ?? null,
      action: 'COURSE_GROUPS_VIEW_DENIED',
      severity: 'SECURITY',
      metadata: {},
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

/**
 * Creates a group in the course. Course staff (faculty or TAs) or a system admin.
 * Also doubles as a
 * "list" endpoint: a body of `{ action: 'list' }` returns the groups instead of
 * creating one — a workaround so the client can list without needing a GET's
 * AbortController plumbing. Group names are unique per course.
 * @openapi
 * summary: Create a course group (or list via body)
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 * requestBody:
 *   required: true
 *   content:
 *     application/json:
 *       schema:
 *         type: object
 *         properties:
 *           name: { type: string, description: New group name (create mode) }
 *           action: { type: string, enum: [list], description: Return the group list instead of creating }
 * responses:
 *   200: { description: The group list (when action is "list"). }
 *   201: { description: The created group. }
 *   401: { description: Not signed in. }
 *   403: { description: Not course staff or a system admin. }
 *   404: { description: Course not found. }
 *   409: { description: A group with that name already exists in the course. }
 *   422: { description: Missing group name. }
 *   500: { description: Server error. }
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  if (!id) {
    return NextResponse.json({ error: 'Missing course ID' }, { status: 400 });
  }

  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!(await canManageCourse(session.user, id))) {
    await createEnhancedActivityLog(prisma, req, {
      userId: session?.user?.id ?? null,
      action: 'GROUP_CREATE_DENIED',
      severity: 'SECURITY',
      metadata: {},
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
