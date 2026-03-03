// /src/app/api/assignments/[id]

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
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

type LateSubmissionStateResult =
  | { ok: true; allowLateSubmissions: boolean; lateCutoff: Date | null }
  | { ok: false; message: string };

function computeLateSubmissionState(options: {
  incomingAllowLate?: boolean;
  incomingLateCutoff?: string | null;
  existingAllowLate: boolean;
  existingLateCutoff: Date | null;
  dueDate: Date;
  userTimezone: string;
}): LateSubmissionStateResult {
  const {
    incomingAllowLate,
    incomingLateCutoff,
    existingAllowLate,
    existingLateCutoff,
    dueDate,
    userTimezone,
  } = options;

  const allowLateSubmissions =
    typeof incomingAllowLate === 'boolean' ? incomingAllowLate : existingAllowLate;

  let lateCutoff = existingLateCutoff;

  if (allowLateSubmissions) {
    if (incomingLateCutoff === undefined) {
      if (!lateCutoff) {
        return {
          ok: false,
          message: 'Late submission cutoff is required when late submissions are enabled.',
        };
      }
    } else if (!incomingLateCutoff) {
      return {
        ok: false,
        message: 'Late submission cutoff is required when late submissions are enabled.',
      };
    } else {
      lateCutoff = toDateTimeInTimezone(incomingLateCutoff, userTimezone);
    }

    if (lateCutoff && lateCutoff < dueDate) {
      return {
        ok: false,
        message: 'Late cutoff must be on or after the due date.',
      };
    }
  } else {
    if (incomingLateCutoff && incomingLateCutoff !== null) {
      return {
        ok: false,
        message: 'Late cutoff provided but late submissions are disabled.',
      };
    }
    lateCutoff = null;
  }

  return { ok: true, allowLateSubmissions, lateCutoff };
}

// Get a single assignment by ID
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const session = await auth();

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const assignment = await prisma.assignment.findUnique({
      where: { id },
      include: {
        course: true,
        problems: {
          include: {
            problem: true,
          },
        },
      },
    });

    if (!assignment) {
      return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
    }

    // Check permissions - students can only see published assignments in courses they're enrolled in
    if (session.user.role === 'STUDENT') {
      // Check if assignment is published
      if (!assignment.isPublished) {
        return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
      }

      // Check if student is enrolled in the course
      const enrollment = await prisma.roster.findFirst({
        where: {
          courseId: assignment.courseId,
          userId: session.user.id,
          role: 'STUDENT', // Use CourseRole enum value
        },
      });

      if (!enrollment) {
        return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
      }
    }
    // For non-students (FACULTY/TA), check if they have access to the course
    else if (!['ADMIN'].includes(session.user.role)) {
      const hasAccess = await prisma.roster.findFirst({
        where: {
          courseId: assignment.courseId,
          userId: session.user.id,
          role: { in: ['FACULTY', 'TA'] },
        },
      });

      if (!hasAccess && session.user.role !== 'ADMIN') {
        return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
      }
    }

    const totalProblemPoints = (assignment.problems ?? []).reduce((sum, ap) => {
      const value = typeof ap.maxPoints === 'number' ? ap.maxPoints : 0;
      return sum + (Number.isFinite(value) ? value : 0);
    }, 0);

    return NextResponse.json({
      ...assignment,
      maxPoints: totalProblemPoints,
    });
  } catch (error) {
    console.error('Failed to fetch assignment:', error);
    return NextResponse.json({ error: 'Failed to fetch assignment' }, { status: 500 });
  }
}

// Update an existing assignment (full update)
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const session = await auth();

  if (!session || !['ADMIN', 'FACULTY', 'TA'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const data = await req.json();
  const userTimezone = await resolveUserTimezone(session.user.id);

  // Make sure the assignment does not have any submissions or grades when unpublishing
  if (data.isPublished === false) {
    // Note logic appears swapped for isPublished, but that is because isPublished is the next state
    const hasSubmission = !!(await prisma.assignmentProblem.findFirst({
      where: { assignmentId: id, submissions: { some: {} } },
      select: { assignmentId: true },
    }));

    const hasGrade = !!(await prisma.assignmentGrade.findFirst({
      where: { assignmentId: id },
      select: { assignmentId: true },
    }));

    if (hasSubmission) {
      return NextResponse.json(
        { error: 'Assignment must not have any submissions' },
        { status: 403 },
      );
    }

    if (hasGrade) {
      return NextResponse.json({ error: 'Assignment must not have any grades' }, { status: 403 });
    }
  }

  try {
    const existing = await prisma.assignment.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
    }

    const dueDate = data.dueDate
      ? toEndOfDayInTimezone(data.dueDate, userTimezone)
      : existing.dueDate;

    const lateState = computeLateSubmissionState({
      incomingAllowLate: data.allowLateSubmissions,
      incomingLateCutoff: data.lateCutoff,
      existingAllowLate: existing.allowLateSubmissions,
      existingLateCutoff: existing.lateCutoff,
      dueDate,
      userTimezone,
    });

    if (!lateState.ok) {
      return NextResponse.json({ error: lateState.message }, { status: 400 });
    }

    const { allowLateSubmissions, lateCutoff } = lateState;

    const updated = await prisma.assignment.update({
      where: { id },
      data: {
        title: data.title ?? existing.title,
        description: data.description ?? existing.description,
        dueDate,
        isPublished: data.isPublished ?? existing.isPublished,
        allowLateSubmissions,
        lateCutoff,
      },
    });

    await createEnhancedActivityLog(prisma, req, {
      userId: session.user.id,
      action: 'UPDATE_ASSIGNMENT',
      category: 'ASSIGNMENT',
      courseId: updated.courseId,
      assignmentId: id,
      metadata: {
        userId: session.user.id,
        courseId: updated.courseId,
        assignmentId: id,
        updatedFields: Object.keys(data),
        allowLateSubmissions,
        lateCutoff: lateCutoff ? lateCutoff.toISOString() : null,
      },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error('Assignment update failed:', error);
    return NextResponse.json({ error: 'Failed to update assignment' }, { status: 500 });
  }
}

// Partial update of an assignment (PATCH)
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const session = await auth();

  if (!session || !['ADMIN', 'FACULTY', 'TA'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const data = await req.json();
  const userTimezone = await resolveUserTimezone(session.user.id);

  // Make sure the assignment does not have any submissions or grades when unpublishing
  if (!data.isPublished) {
    // Note logic appears swapped for isPublished, but that is because isPublished is the next state
    const hasSubmission = !!(await prisma.assignmentProblem.findFirst({
      where: { assignmentId: id, submissions: { some: {} } },
      select: { assignmentId: true },
    }));

    const hasGrade = !!(await prisma.assignmentGrade.findFirst({
      where: { assignmentId: id },
      select: { assignmentId: true },
    }));

    if (hasSubmission) {
      return NextResponse.json(
        { error: 'Assignment must not have any submissions' },
        { status: 403 },
      );
    }

    if (hasGrade) {
      return NextResponse.json({ error: 'Assignment must not have any grades' }, { status: 403 });
    }
  }

  try {
    const existing = await prisma.assignment.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
    }

    const effectiveDueDate =
      data.dueDate !== undefined
        ? toEndOfDayInTimezone(data.dueDate, userTimezone)
        : existing.dueDate;

    const lateState = computeLateSubmissionState({
      incomingAllowLate: data.allowLateSubmissions,
      incomingLateCutoff: data.lateCutoff,
      existingAllowLate: existing.allowLateSubmissions,
      existingLateCutoff: existing.lateCutoff,
      dueDate: effectiveDueDate,
      userTimezone,
    });

    if (!lateState.ok) {
      return NextResponse.json({ error: lateState.message }, { status: 400 });
    }

    const { allowLateSubmissions, lateCutoff } = lateState;

    // Build update data object with only provided fields
    const updateData: {
      title?: string;
      description?: string;
      dueDate?: Date;
      isPublished?: boolean;
      allowLateSubmissions?: boolean;
      lateCutoff?: Date | null;
    } = {};

    if (data.title !== undefined) updateData.title = data.title;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.dueDate !== undefined) {
      updateData.dueDate = effectiveDueDate;
    }
    if (data.isPublished !== undefined) updateData.isPublished = data.isPublished;
    if (data.allowLateSubmissions !== undefined) {
      updateData.allowLateSubmissions = allowLateSubmissions;
    }
    if (
      data.lateCutoff !== undefined ||
      data.allowLateSubmissions !== undefined ||
      data.dueDate !== undefined
    ) {
      updateData.lateCutoff = lateCutoff;
    }

    const updated = await prisma.assignment.update({
      where: { id },
      data: updateData,
    });

    await createEnhancedActivityLog(prisma, req, {
      userId: session.user.id,
      action: 'UPDATE_ASSIGNMENT',
      category: 'ASSIGNMENT',
      courseId: updated.courseId,
      assignmentId: id,
      metadata: {
        userId: session.user.id,
        courseId: updated.courseId,
        assignmentId: id,
        updatedFields: Object.keys(updateData),
        allowLateSubmissions,
        lateCutoff: lateCutoff ? lateCutoff.toISOString() : null,
      },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error('Assignment partial update failed:', error);
    return NextResponse.json({ error: 'Failed to update assignment' }, { status: 500 });
  }
}

// Create a new assignment (POST /api/assignments/[id])
export async function POST(req: NextRequest) {
  const session = await auth();

  if (!session || !['ADMIN', 'FACULTY', 'TA'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  try {
    const data = await req.json();
    const userTimezone = await resolveUserTimezone(session.user.id);

    if (!data.title || !data.courseId) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const allowLateSubmissions =
      typeof data.allowLateSubmissions === 'boolean' ? data.allowLateSubmissions : true;

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
    const lateCutoff =
      allowLateSubmissions && data.lateCutoff
        ? toDateTimeInTimezone(data.lateCutoff, userTimezone)
        : null;

    if (lateCutoff && lateCutoff < dueDate) {
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
        lateCutoff,
        isPublished: data.isPublished || false,
        courseId: data.courseId,
      },
    });

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
        allowLateSubmissions: created.allowLateSubmissions,
        lateCutoff: created.lateCutoff ? created.lateCutoff.toISOString() : null,
      },
    });

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    console.error('Assignment creation failed:', error);
    return NextResponse.json({ error: 'Failed to create assignment' }, { status: 500 });
  }
}

// Delete an assignment if safe
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const session = await auth();

  if (!session || !['ADMIN', 'FACULTY', 'TA'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  try {
    // Find the assignment to get courseId
    const assignment = await prisma.assignment.findUnique({ where: { id } });
    if (!assignment) {
      return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
    }

    // Check for any submissions associated with this assignment via AssignmentProblem -> Submission
    const submissionCount = await prisma.submission.count({ where: { assignmentId: id } });
    if (submissionCount > 0) {
      return NextResponse.json(
        { error: 'Cannot delete assignment: submissions exist' },
        { status: 400 },
      );
    }

    // Check for any comments associated with this assignment
    const commentCount = await prisma.comment.count({ where: { assignmentId: id } });
    if (commentCount > 0) {
      return NextResponse.json(
        { error: 'Cannot delete assignment: comments exist' },
        { status: 400 },
      );
    }

    // Safe to delete: remove AssignmentProblem links first, then delete the assignment
    await prisma.assignmentProblem.deleteMany({ where: { assignmentId: id } });

    const deleted = await prisma.assignment.delete({ where: { id } });

    // Log the deletion
    try {
      await createEnhancedActivityLog(prisma, req as Request, {
        userId: session.user.id,
        action: 'DELETE_ASSIGNMENT',
        category: 'ASSIGNMENT',
        courseId: deleted.courseId,
        assignmentId: id,
        metadata: {
          userId: session.user.id,
          courseId: deleted.courseId,
          assignmentId: id,
          title: deleted.title,
        },
      });
    } catch (logErr) {
      console.error('Failed to write activity log for assignment deletion', logErr);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Assignment delete failed:', error);
    return NextResponse.json({ error: 'Failed to delete assignment' }, { status: 500 });
  }
}
