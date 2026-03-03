// /src/app/api/assignments

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
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

export async function POST(req: NextRequest) {
  try {
    // Retrieve the current authenticated session
    const session = await auth();

    // Ensure user is authenticated and has the correct role
    if (!session || !['ADMIN', 'FACULTY', 'TA'].includes(session.user.role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // Parse incoming request data
    const data = await req.json();

    // Validate required fields
    if (!data.title || !data.courseId) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
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

    // Create a new assignment in the database
    const created = await prisma.assignment.create({
      data: {
        title: data.title,
        description: data.description,
        dueDate,
        allowLateSubmissions,
        lateCutoff: lateCutoffDate,
        isPublished: data.isPublished || false,
        // Persist isGroup when provided (default to false)
        isGroup: !!data.isGroup,
        courseId: data.courseId,
      },
    });

    // Log the creation action to ActivityLog
    await createEnhancedActivityLog(prisma, req, {
      userId: session.user.id,
      action: 'CREATE_ASSIGNMENT',
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

    // Respond with the newly created assignment
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    // Log error to the server console
    console.error('Assignment creation failed:', error);
    return NextResponse.json({ error: 'Failed to create assignment' }, { status: 500 });
  }
}
