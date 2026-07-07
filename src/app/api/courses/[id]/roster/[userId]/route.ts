import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { isAdmin } from '@/lib/permissions';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';

/**
 * Removes a user from a course roster. Permission is tiered: global admins and
 * course faculty may remove people, but TAs and students may not, and a faculty
 * member may not remove another faculty member. Two safety rules block the removal
 * outright — the user must have no submissions in the course, and a course can't
 * lose its last faculty member.
 * @openapi
 * summary: Remove a user from a course
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 *   - { name: userId, in: path, required: true, schema: { type: string } }
 * responses:
 *   200:
 *     description: Removed; returns how many roster rows were deleted.
 *     content:
 *       application/json:
 *         schema: { type: object, properties: { success: { type: boolean }, removed: { type: integer } } }
 *   400: { description: "User has submissions, or is the only faculty member." }
 *   401: { description: Not signed in. }
 *   403: { description: Caller's role may not remove this user. }
 *   500: { description: Server error. }
 */
export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string; userId: string }> },
) {
  const { id: courseId, userId } = await context.params;
  let actorId: string | null = null;

  try {
    const session = await auth();
    const currentUser = session?.user;

    if (!currentUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    actorId = currentUser.id;

    // Determine the current user's course role (if any)
    const currentRoster = await prisma.roster.findFirst({
      where: { courseId, userId: currentUser.id },
      select: { role: true },
    });
    const currentCourseRole = currentRoster?.role ?? null;
    const currentCourseRoleValue = String(currentCourseRole ?? '');

    // Only global admins or course-level FACULTY/TA may attempt removal
    if (!isAdmin(currentUser) && !['FACULTY', 'TA'].includes(currentCourseRoleValue)) {
      await createEnhancedActivityLog(prisma, req as unknown as Request, {
        userId: session?.user?.id ?? null,
        action: 'ROSTER_REMOVE_DENIED',
        severity: 'SECURITY',
        metadata: {},
      });
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // TAs and STUDENTs may not remove users
    if (currentCourseRoleValue === 'TA' || currentCourseRoleValue === 'STUDENT') {
      await createEnhancedActivityLog(prisma, req as unknown as Request, {
        userId: session?.user?.id ?? null,
        action: 'ROSTER_REMOVE_DENIED',
        severity: 'SECURITY',
        metadata: {},
      });
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Get the target's roster entry to check role constraints
    const targetRoster = await prisma.roster.findFirst({
      where: { courseId, userId },
      select: { role: true },
    });
    const targetCourseRoleValue = String(targetRoster?.role ?? '');

    // A faculty member may not remove another faculty member (a global admin may).
    if (
      currentCourseRoleValue === 'FACULTY' &&
      targetRoster &&
      targetCourseRoleValue === 'FACULTY'
    ) {
      await createEnhancedActivityLog(prisma, req as unknown as Request, {
        userId: session?.user?.id ?? null,
        action: 'ROSTER_REMOVE_DENIED',
        severity: 'SECURITY',
        metadata: {},
      });
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Prevent removal if the user has any submissions in this course
    const assignmentIds = await prisma.assignment.findMany({
      where: { courseId },
      select: { id: true },
    });
    const assignmentIdList = Array.isArray(assignmentIds)
      ? assignmentIds.map((a: (typeof assignmentIds)[number]) => a.id)
      : [];

    if (assignmentIdList.length > 0) {
      const existingSubmission = await prisma.submission.findFirst({
        where: {
          studentId: userId,
          assignmentId: { in: assignmentIdList },
        },
      });

      if (existingSubmission) {
        return NextResponse.json(
          { error: 'User has submissions for this course and cannot be removed' },
          { status: 400 },
        );
      }
    }

    // Prevent removing the only faculty member from a course
    // Check whether the user to remove is a faculty member on the roster
    const rosterEntry = await prisma.roster.findFirst({
      where: { courseId, userId },
      select: { role: true },
    });
    if (rosterEntry && rosterEntry.role === 'FACULTY') {
      const facultyCount = await prisma.roster.count({ where: { courseId, role: 'FACULTY' } });
      if (facultyCount <= 1) {
        return NextResponse.json(
          { error: 'Cannot remove the only faculty member from the course' },
          { status: 400 },
        );
      }
    }
    // Delete any roster entries for this user in the course
    const deleted = await prisma.roster.deleteMany({ where: { courseId, userId } });

    // Log activity
    await createEnhancedActivityLog(prisma, req as unknown as Request, {
      userId: currentUser.id,
      action: 'REMOVE_FROM_COURSE',
      severity: 'INFO',
      category: 'COURSE',
      courseId,
      metadata: {
        userId: currentUser.id,
        courseId: courseId,
        removedUserId: userId,
        count: deleted.count,
      },
    });

    return NextResponse.json({ success: true, removed: deleted.count });
  } catch (err) {
    console.error('DELETE /api/courses/[id]/roster/[userId] error:', err);
    await createEnhancedActivityLog(prisma, req as unknown as Request, {
      userId: actorId,
      action: 'ROSTER_REMOVE_ERROR',
      severity: 'ERROR',
      metadata: { error: err instanceof Error ? err.message : 'unknown error' },
    });
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

/**
 * Returns one roster entry (with the user's profile) plus the viewer's own course
 * and global roles, so the UI can decide which actions to offer. Any signed-in
 * user may call it; `userId` may be the literal "me" to target the caller.
 * @openapi
 * summary: Get a roster entry
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 *   - { name: userId, in: path, required: true, description: 'A user id, or "me" for the caller', schema: { type: string } }
 * responses:
 *   200:
 *     description: The roster entry and the viewer's roles.
 *   401: { description: Not signed in. }
 *   404: { description: No roster entry for that user in this course. }
 *   500: { description: Server error. }
 */
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string; userId: string }> },
) {
  const { id: courseId, userId } = await context.params;

  try {
    const session = await auth();
    const currentUser = session?.user;
    if (!currentUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const targetUserId = userId === 'me' ? currentUser.id : userId;

    // Fetch roster entry and include the user profile info for display in the dialog
    const rosterEntry = await prisma.roster.findFirst({
      where: { courseId, userId: targetUserId },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            avatar: true,
          },
        },
      },
    });
    if (!rosterEntry) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // Also return the viewer's admin flag and course role so the UI can decide which actions to show
    const viewerRoster = await prisma.roster.findFirst({
      where: { courseId, userId: currentUser.id },
      select: { role: true },
    });
    const viewerCourseRole = viewerRoster?.role ?? null;
    const viewerIsAdmin = isAdmin(currentUser);

    return NextResponse.json({
      success: true,
      roster: rosterEntry,
      viewerCourseRole,
      viewerIsAdmin,
    });
  } catch (err) {
    console.error('GET /api/courses/[id]/roster/[userId] error:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

/**
 * Changes a user's course role. Only a global admin or a course faculty member may
 * do this. The last faculty member can't be demoted, keeping every course with
 * someone in charge.
 * @openapi
 * summary: Change a user's course role
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 *   - { name: userId, in: path, required: true, schema: { type: string } }
 * requestBody:
 *   required: true
 *   content:
 *     application/json:
 *       schema:
 *         type: object
 *         required: [role]
 *         properties:
 *           role: { type: string, enum: [FACULTY, TA, STUDENT] }
 * responses:
 *   200:
 *     description: Role updated.
 *   400: { description: "Invalid role, or demoting the only instructor." }
 *   401: { description: Not signed in. }
 *   403: { description: Caller is not an admin or the course instructor. }
 *   404: { description: Roster entry not found. }
 *   500: { description: Server error. }
 */
export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string; userId: string }> },
) {
  const { id: courseId, userId } = await context.params;
  let actorId: string | null = null;

  try {
    const session = await auth();
    const currentUser = session?.user;
    if (!currentUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    actorId = currentUser.id;

    const body = await req.json();
    const newRole = body?.role;
    const allowedRoles = ['FACULTY', 'TA', 'STUDENT'];
    if (!allowedRoles.includes(newRole))
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 });

    // Check permissions: global admin or a course faculty member
    const currentRoster = await prisma.roster.findFirst({
      where: { courseId, userId: currentUser.id },
    });
    const isAllowed = isAdmin(currentUser) || currentRoster?.role === 'FACULTY';
    if (!isAllowed) {
      await createEnhancedActivityLog(prisma, req as unknown as Request, {
        userId: session?.user?.id ?? null,
        action: 'ROSTER_UPDATE_DENIED',
        severity: 'SECURITY',
        metadata: {},
      });
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Ensure roster entry exists
    const target = await prisma.roster.findFirst({
      where: { courseId, userId },
      select: { id: true, role: true },
    });
    if (!target) return NextResponse.json({ error: 'Roster entry not found' }, { status: 404 });

    // Prevent demoting the only faculty member
    if (target.role === 'FACULTY' && newRole !== 'FACULTY') {
      const facultyCount = await prisma.roster.count({
        where: { courseId, role: 'FACULTY' },
      });
      if (facultyCount <= 1) {
        return NextResponse.json(
          { error: 'Cannot demote the only course faculty member' },
          { status: 400 },
        );
      }
    }

    const updated = await prisma.roster.update({
      where: { id: target.id },
      data: { role: newRole },
    });

    await createEnhancedActivityLog(prisma, req as unknown as Request, {
      userId: currentUser.id,
      action: 'CHANGE_COURSE_ROLE',
      severity: 'INFO',
      category: 'COURSE',
      courseId,
      metadata: {
        userId: currentUser.id,
        courseId,
        targetUserId: userId,
        previousRole: target.role,
        newRole,
      },
    });

    return NextResponse.json({ success: true, roster: updated });
  } catch (err) {
    console.error('PATCH /api/courses/[id]/roster/[userId] error:', err);
    await createEnhancedActivityLog(prisma, req as unknown as Request, {
      userId: actorId,
      action: 'ROSTER_UPDATE_ERROR',
      severity: 'ERROR',
      metadata: { error: err instanceof Error ? err.message : 'unknown error' },
    });
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
