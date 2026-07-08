import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { canAccessCourse, canManageCourse } from '@/lib/permissions';
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

/**
 * Fetches one assignment with its course and problems, plus a derived `maxPoints`
 * total. Visibility is role-aware: students only see published assignments in
 * courses they're enrolled in, faculty/TA need access to the course, and admins see
 * anything. Anything the caller may not see is masked as a 404.
 * @openapi
 * summary: Get an assignment
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 * responses:
 *   200: { description: The assignment with its problems and maxPoints. }
 *   401: { description: Not signed in. }
 *   404: { description: "Not found, or not visible to the caller." }
 *   500: { description: Server error. }
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  try {
    const assignment = await prisma.assignment.findUnique({
      where: { id },
      include: {
        // Only the fields the client reads (matches the SSR shape and
        // AssignmentCourseSummary); avoids leaking regCode and other course
        // columns into a student-facing payload.
        course: {
          select: { id: true, name: true, code: true, isArchived: true },
        },
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

    // Staff/admin see anything; otherwise the assignment must be published AND the
    // caller enrolled in the course. Everything else is masked as 404.
    if (!(await canManageCourse(session.user, assignment.courseId))) {
      if (!assignment.isPublished || !(await canAccessCourse(session.user, assignment.courseId))) {
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

/**
 * Full update of an assignment. Course staff (faculty or TAs) or a system admin.
 * Guards protect data
 * integrity: an assignment can't be unpublished once it has submissions or grades,
 * and its group mode can't change after any submission exists. Late-submission
 * rules are validated the same way as on create.
 * @openapi
 * summary: Update an assignment (full)
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 * requestBody:
 *   required: true
 *   content:
 *     application/json:
 *       schema:
 *         type: object
 *         properties:
 *           title: { type: string }
 *           description: { type: string }
 *           dueDate: { type: string }
 *           allowLateSubmissions: { type: boolean }
 *           lateCutoff: { type: string, nullable: true }
 *           isPublished: { type: boolean }
 *           isGroup: { type: boolean }
 * responses:
 *   200: { description: The updated assignment. }
 *   400: { description: Inconsistent late-submission window. }
 *   401: { description: Not signed in. }
 *   403: { description: "Not course staff or a system admin, or a state guard blocked the change." }
 *   404: { description: Assignment not found. }
 *   500: { description: Server error. }
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const session = await auth();

  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const assignmentForAuth = await prisma.assignment.findUnique({
    where: { id },
    select: { courseId: true },
  });
  if (!assignmentForAuth) {
    return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
  }
  if (!(await canManageCourse(session.user, assignmentForAuth.courseId))) {
    await createEnhancedActivityLog(prisma, req, {
      userId: session?.user?.id ?? null,
      action: 'ASSIGNMENT_UPDATE_DENIED',
      severity: 'SECURITY',
      metadata: {},
    });
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

    const hasGrade = !!(await prisma.assignmentProblemGrade.findFirst({
      where: { assignmentId: id },
      select: { assignmentId: true },
    }));

    if (hasSubmission) {
      await createEnhancedActivityLog(prisma, req, {
        userId: session?.user?.id ?? null,
        action: 'ASSIGNMENT_UPDATE_DENIED',
        severity: 'SECURITY',
        metadata: {},
      });
      return NextResponse.json(
        { error: 'Assignment must not have any submissions' },
        { status: 403 },
      );
    }

    if (hasGrade) {
      await createEnhancedActivityLog(prisma, req, {
        userId: session?.user?.id ?? null,
        action: 'ASSIGNMENT_UPDATE_DENIED',
        severity: 'SECURITY',
        metadata: {},
      });
      return NextResponse.json({ error: 'Assignment must not have any grades' }, { status: 403 });
    }
  }

  const result = await prisma.assignment.findFirst({
    where: { id },
	select: { isGroup: true },
  });

  const curGroup = result?.isGroup;

  // Prevent changing the assignment's group mode if submissions exist
  if (data.isGroup !== undefined && data.isGroup !== curGroup) {
    const hasAnySubmission = (await prisma.submission.count({ where: { assignmentId: id } })) > 0;
    if (hasAnySubmission) {
      await createEnhancedActivityLog(prisma, req, {
        userId: session?.user?.id ?? null,
        action: 'ASSIGNMENT_UPDATE_DENIED',
        severity: 'SECURITY',
        metadata: {},
      });
      return NextResponse.json(
        { error: 'Cannot change assignment group mode after submissions exist' },
        { status: 403 },
      );
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
        title: data.title,
        description: data.description,
        dueDate: toEndOfDayInTimezone(data.dueDate, userTimezone),
        allowLateSubmissions,
        lateCutoff,
        isPublished: data.isPublished,
        isGroup: data.isGroup === undefined ? undefined : data.isGroup,
      },
    });

    await createEnhancedActivityLog(prisma, req, {
      userId: session.user.id,
      action: 'UPDATE_ASSIGNMENT',
      severity: 'INFO',
      category: 'ASSIGNMENT',
      courseId: updated.courseId,
      assignmentId: id,
      metadata: {
        userId: session.user.id,
        courseId: updated.courseId,
        assignmentId: id,
        title: updated.title,
        isPublished: updated.isPublished,
        dueDate: updated.dueDate ? updated.dueDate.toISOString() : null,
        allowLateSubmissions: updated.allowLateSubmissions,
        lateCutoff: updated.lateCutoff ? updated.lateCutoff.toISOString() : null,
        isGroup: updated.isGroup,
      },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error('Assignment update failed:', error);
    await createEnhancedActivityLog(prisma, req, {
      userId: session?.user?.id ?? null,
      action: 'ASSIGNMENT_UPDATE_ERROR',
      severity: 'ERROR',
      metadata: { error: error instanceof Error ? error.message : 'unknown error' },
    });
    return NextResponse.json({ error: 'Failed to update assignment' }, { status: 500 });
  }
}

/**
 * Partial update of an assignment — only the fields present in the body are
 * changed. Course staff (faculty or TAs) or a system admin, with the same
 * unpublish/group-mode guards and late-window validation as the full update.
 * @openapi
 * summary: Update an assignment (partial)
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 * requestBody:
 *   required: true
 *   content:
 *     application/json:
 *       schema:
 *         type: object
 *         properties:
 *           title: { type: string }
 *           description: { type: string }
 *           dueDate: { type: string }
 *           allowLateSubmissions: { type: boolean }
 *           lateCutoff: { type: string, nullable: true }
 *           isPublished: { type: boolean }
 *           isGroup: { type: boolean }
 * responses:
 *   200: { description: The updated assignment. }
 *   400: { description: Inconsistent late-submission window. }
 *   401: { description: Not signed in. }
 *   403: { description: "Not course staff or a system admin, or a state guard blocked the change." }
 *   404: { description: Assignment not found. }
 *   500: { description: Server error. }
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const session = await auth();

  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const assignmentForAuth = await prisma.assignment.findUnique({
    where: { id },
    select: { courseId: true },
  });
  if (!assignmentForAuth) {
    return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
  }
  if (!(await canManageCourse(session.user, assignmentForAuth.courseId))) {
    await createEnhancedActivityLog(prisma, req, {
      userId: session?.user?.id ?? null,
      action: 'ASSIGNMENT_UPDATE_DENIED',
      severity: 'SECURITY',
      metadata: {},
    });
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

    const hasGrade = !!(await prisma.assignmentProblemGrade.findFirst({
      where: { assignmentId: id },
      select: { assignmentId: true },
    }));

    if (hasSubmission) {
      await createEnhancedActivityLog(prisma, req, {
        userId: session?.user?.id ?? null,
        action: 'ASSIGNMENT_UPDATE_DENIED',
        severity: 'SECURITY',
        metadata: {},
      });
      return NextResponse.json(
        { error: 'Assignment must not have any submissions' },
        { status: 403 },
      );
    }

    if (hasGrade) {
      await createEnhancedActivityLog(prisma, req, {
        userId: session?.user?.id ?? null,
        action: 'ASSIGNMENT_UPDATE_DENIED',
        severity: 'SECURITY',
        metadata: {},
      });
      return NextResponse.json({ error: 'Assignment must not have any grades' }, { status: 403 });
    }
  }

  // Prevent changing the assignment's group mode if submissions exist
  if (data.isGroup !== undefined) {
    const hasAnySubmission = (await prisma.submission.count({ where: { assignmentId: id } })) > 0;
    if (hasAnySubmission) {
      await createEnhancedActivityLog(prisma, req, {
        userId: session?.user?.id ?? null,
        action: 'ASSIGNMENT_UPDATE_DENIED',
        severity: 'SECURITY',
        metadata: {},
      });
      return NextResponse.json(
        { error: 'Cannot change assignment group mode after submissions exist' },
        { status: 403 },
      );
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
      allowLateSubmissions?: boolean;
      lateCutoff?: Date | null;
      isPublished?: boolean;
      isGroup?: boolean;
    } = {};

    if (data.title !== undefined) updateData.title = data.title;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.dueDate !== undefined) {
      updateData.dueDate = effectiveDueDate;
    }
    if (data.allowLateSubmissions !== undefined) {
      updateData.allowLateSubmissions = allowLateSubmissions;
    }
    if (data.lateCutoff !== undefined) {
      updateData.lateCutoff = lateCutoff;
    }
    if (data.isPublished !== undefined) updateData.isPublished = data.isPublished;
    if (data.isGroup !== undefined) updateData.isGroup = data.isGroup;

    const updated = await prisma.assignment.update({
      where: { id },
      data: updateData,
    });

    await createEnhancedActivityLog(prisma, req, {
      userId: session.user.id,
      action: 'UPDATE_ASSIGNMENT',
      severity: 'INFO',
      category: 'ASSIGNMENT',
      courseId: updated.courseId,
      assignmentId: id,
      metadata: {
        userId: session.user.id,
        courseId: updated.courseId,
        assignmentId: id,
        changedFields: Object.keys(updateData),
        title: updated.title,
        isPublished: updated.isPublished,
        dueDate: updated.dueDate ? updated.dueDate.toISOString() : null,
        allowLateSubmissions: updated.allowLateSubmissions,
        lateCutoff: updated.lateCutoff ? updated.lateCutoff.toISOString() : null,
        isGroup: updated.isGroup,
      },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error('Assignment partial update failed:', error);
    await createEnhancedActivityLog(prisma, req, {
      userId: session?.user?.id ?? null,
      action: 'ASSIGNMENT_UPDATE_ERROR',
      severity: 'ERROR',
      metadata: { error: error instanceof Error ? error.message : 'unknown error' },
    });
    return NextResponse.json({ error: 'Failed to update assignment' }, { status: 500 });
  }
}

/**
 * Creates an assignment. Course staff (faculty or TAs) or a system admin, checked
 * against the body's courseId. Note: this handler ignores
 * the `[id]` path segment and takes the course from the body — it mirrors
 * POST /api/assignments and exists for clients that post to this path. (One
 * difference: late submissions default to on here.)
 * @openapi
 * summary: Create an assignment (alias)
 * parameters:
 *   - { name: id, in: path, required: true, description: Ignored by this handler, schema: { type: string } }
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
 *           dueDate: { type: string }
 *           allowLateSubmissions: { type: boolean }
 *           lateCutoff: { type: string }
 *           isPublished: { type: boolean }
 *           isGroup: { type: boolean }
 * responses:
 *   201: { description: The created assignment. }
 *   400: { description: "Missing fields, or an inconsistent late-submission window." }
 *   401: { description: Not signed in. }
 *   403: { description: Not course staff or a system admin. }
 *   500: { description: Server error. }
 */
export async function POST(req: NextRequest) {
  const session = await auth();

  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const data = await req.json();
    const userTimezone = await resolveUserTimezone(session.user.id);

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
        isGroup: created.isGroup,
      },
    });

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    console.error('Assignment creation failed:', error);
    await createEnhancedActivityLog(prisma, req, {
      userId: session?.user?.id ?? null,
      action: 'ASSIGNMENT_CREATE_ERROR',
      severity: 'ERROR',
      metadata: { error: error instanceof Error ? error.message : 'unknown error' },
    });
    return NextResponse.json({ error: 'Failed to create assignment' }, { status: 500 });
  }
}

/**
 * Deletes an assignment, but only when it's safe: no submissions and no comments.
 * Its problem links are cleared first, then the assignment is removed. Course staff
 * (faculty or TAs) or a system admin.
 * @openapi
 * summary: Delete an assignment
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 * responses:
 *   200: { description: Assignment deleted. }
 *   400: { description: Submissions or comments exist. }
 *   401: { description: Not signed in. }
 *   403: { description: Not course staff or a system admin. }
 *   404: { description: Assignment not found. }
 *   500: { description: Server error. }
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const session = await auth();

  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const assignmentForAuth = await prisma.assignment.findUnique({
    where: { id },
    select: { courseId: true },
  });
  if (!assignmentForAuth) {
    return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
  }
  if (!(await canManageCourse(session.user, assignmentForAuth.courseId))) {
    await createEnhancedActivityLog(prisma, req, {
      userId: session?.user?.id ?? null,
      action: 'ASSIGNMENT_DELETE_DENIED',
      severity: 'SECURITY',
      metadata: {},
    });
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
        severity: 'INFO',
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
    await createEnhancedActivityLog(prisma, req, {
      userId: session?.user?.id ?? null,
      action: 'ASSIGNMENT_DELETE_ERROR',
      severity: 'ERROR',
      metadata: { error: error instanceof Error ? error.message : 'unknown error' },
    });
    return NextResponse.json({ error: 'Failed to delete assignment' }, { status: 500 });
  }
}
