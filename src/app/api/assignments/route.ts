import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { canManageCourse } from '@/lib/permissions';
import { toDateTimeInTimezone, toEndOfDayInTimezone } from '@/lib/date-utils';

async function resolveUserTimezone(userId?: string | null) {
  const tz = 'America/New_York';
  if (!userId) return tz;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { timezone: true },
  });
  if (user?.timezone) return user.timezone;
  const system = await prisma.systemSettings.findUnique({ where: { id: 1 } });
  return system?.timezone || tz;
}

/**
 * Creates an assignment in a course. Course staff (faculty or TAs) or a system
 * admin, checked against the body's courseId. The due date is
 * interpreted as end-of-day in the actor's timezone. Late submissions and their
 * cutoff must agree — a cutoff is required when late is on, forbidden when off, and
 * must fall on or after the due date.
 * @openapi
 * summary: Create an assignment
 * requestBody:
 *   required: true
 *   content:
 *     application/json:
 *       schema:
 *         type: object
 *         required: [title, courseId]
 *         properties:
 *           title: { type: string }
 *           description: { type: string }
 *           courseId: { type: string }
 *           dueDate: { type: string, description: Interpreted as end-of-day in the actor's timezone }
 *           allowLateSubmissions: { type: boolean }
 *           lateCutoff: { type: string, description: Required when allowLateSubmissions is true }
 *           isPublished: { type: boolean }
 *           isGroup: { type: boolean }
 * responses:
 *   201: { description: The created assignment. }
 *   401: { description: Not signed in. }
 *   400: { description: "Missing fields, or an inconsistent late-submission window." }
 *   403: { description: Not course staff or a system admin. }
 *   500: { description: Server error. }
 */
export async function POST(req: NextRequest) {
  let actorId: string | null = null;
  try {
    const session = await auth();
    actorId = session?.user?.id ?? null;

    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const data = await req.json();
    if (!data.title || !data.courseId) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    if (!(await canManageCourse(session.user, data.courseId))) {
      await createEnhancedActivityLog(prisma, req, {
        userId: session?.user?.id ?? null,
        action: 'ASSIGNMENT_CREATE_DENIED',
        severity: 'SECURITY',
        metadata: {},
      });
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const userTimezone = await resolveUserTimezone(session.user.id);
    const allowLateSubmissions =
      typeof data.allowLateSubmissions === 'boolean' ? data.allowLateSubmissions : false;

    if (!allowLateSubmissions && data.lateCutoff) {
      return NextResponse.json(
        { error: 'Late cutoff provided but late submissions are disabled.' },
        { status: 400 },
      );
    }

    if (allowLateSubmissions && !data.lateCutoff) {
      return NextResponse.json(
        { error: 'Late submission cutoff is required when late submissions are enabled.' },
        { status: 400 },
      );
    }

    const dueDate = toEndOfDayInTimezone(data.dueDate, userTimezone);
    const lateCutoffDate =
      allowLateSubmissions && data.lateCutoff
        ? toDateTimeInTimezone(data.lateCutoff, userTimezone)
        : null;

    if (lateCutoffDate && lateCutoffDate < dueDate) {
      return NextResponse.json(
        { error: 'Late cutoff must be on or after the due date.' },
        { status: 400 },
      );
    }

    const created = await prisma.assignment.create({
      data: {
        title: data.title,
        description: data.description,
        dueDate,
        allowLateSubmissions,
        lateCutoff: lateCutoffDate,
        isPublished: data.isPublished || false,
        isGroup: !!data.isGroup,
        courseId: data.courseId,
      },
    });

    await createEnhancedActivityLog(prisma, req, {
      userId: session.user.id,
      action: 'CREATE_ASSIGNMENT',
      severity: 'INFO',
      category: 'ASSIGNMENT',
      courseId: created.courseId,
      assignmentId: created.id,
      metadata: {
        userId: session.user.id,
        courseId: created.courseId,
        assignmentId: created.id,
        title: created.title,
        description: created.description ? created.description : '',
        isPublished: created.isPublished,
        isGroup: created.isGroup,
        dueDate: created.dueDate.toISOString(),
        allowLateSubmissions: created.allowLateSubmissions,
        lateCutoff: created.lateCutoff ? created.lateCutoff.toISOString() : null,
      },
    });

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    console.error('Assignment creation failed:', error);
    await createEnhancedActivityLog(prisma, req, {
      userId: actorId,
      action: 'ASSIGNMENT_CREATE_ERROR',
      severity: 'ERROR',
      metadata: { error: error instanceof Error ? error.message : 'unknown error' },
    });
    return NextResponse.json({ error: 'Failed to create assignment' }, { status: 500 });
  }
}
