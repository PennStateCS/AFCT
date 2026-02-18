// /src/app/api/assignments/[id]

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { toEndOfDayInTimezone } from '@/lib/date-utils';

async function resolveUserTimezone(userId?: string | null) {
  let tz = 'America/New_York';
  if (!userId) return tz;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { timezone: true },
  });
  if (user?.timezone) return user.timezone;
  const system = await prisma.systemSettings.findUnique({ where: { id: 1 } });
  return system?.timezone || tz;
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
    const updated = await prisma.assignment.update({
      where: { id },
      data: {
        title: data.title,
        description: data.description,
        dueDate: toEndOfDayInTimezone(data.dueDate, userTimezone),
        isPublished: data.isPublished,
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
    // Build update data object with only provided fields
    const updateData: {
      title?: string;
      description?: string;
      dueDate?: Date;
      isPublished?: boolean;
    } = {};

    if (data.title !== undefined) updateData.title = data.title;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.dueDate !== undefined) {
      updateData.dueDate = toEndOfDayInTimezone(data.dueDate, userTimezone);
    }
    if (data.isPublished !== undefined) updateData.isPublished = data.isPublished;

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

    const created = await prisma.assignment.create({
      data: {
        title: data.title,
        description: data.description,
        dueDate: toEndOfDayInTimezone(data.dueDate, userTimezone),
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
