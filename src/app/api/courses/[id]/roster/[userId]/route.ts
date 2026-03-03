import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string; userId: string }> },
) {
  const { id: courseId, userId } = await context.params;

  try {
    const session = await auth();
    const currentUser = session?.user;

    if (!currentUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Determine the current user's course role (if any)
    const currentRoster = await prisma.roster.findFirst({
      where: { courseId, userId: currentUser.id },
      select: { role: true },
    });
    const currentCourseRole = currentRoster?.role ?? null;
    const currentCourseRoleValue = String(currentCourseRole ?? '');

    // Only global ADMIN or course-level INSTRUCTOR/FACULTY/TA may attempt removal
    if (
      currentUser.role !== 'ADMIN' &&
      !['ADMIN', 'INSTRUCTOR', 'FACULTY', 'TA'].includes(currentCourseRoleValue)
    ) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // TAs and STUDENTs may not remove users
    if (currentCourseRoleValue === 'TA' || currentCourseRoleValue === 'STUDENT') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Get the target's roster entry to check role constraints
    const targetRoster = await prisma.roster.findFirst({
      where: { courseId, userId },
      select: { role: true },
    });
    const targetCourseRoleValue = String(targetRoster?.role ?? '');

    // Faculty may not remove instructor/faculty
    if (
      currentCourseRoleValue === 'FACULTY' &&
      targetRoster &&
      ['ADMIN', 'INSTRUCTOR', 'FACULTY'].includes(targetCourseRoleValue)
    ) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Course admins/instructors may not remove other course admins/instructors
    if (
      ['ADMIN', 'INSTRUCTOR'].includes(currentCourseRoleValue) &&
      targetRoster &&
      ['ADMIN', 'INSTRUCTOR'].includes(targetCourseRoleValue)
    ) {
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
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

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
            role: true,
          },
        },
      },
    });
    if (!rosterEntry) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // Also return the viewer's global role and course role so the UI can decide which actions to show
    const viewerRoster = await prisma.roster.findFirst({
      where: { courseId, userId: currentUser.id },
      select: { role: true },
    });
    const viewerCourseRole = viewerRoster?.role ?? null;
    const viewerDefaultRole = currentUser.role ?? null;

    return NextResponse.json({
      success: true,
      roster: rosterEntry,
      viewerCourseRole,
      viewerDefaultRole,
    });
  } catch (err) {
    console.error('GET /api/courses/[id]/roster/[userId] error:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string; userId: string }> },
) {
  const { id: courseId, userId } = await context.params;

  try {
    const session = await auth();
    const currentUser = session?.user;
    if (!currentUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const newRole = body?.role;
    const allowedRoles = ['INSTRUCTOR', 'FACULTY', 'TA', 'STUDENT'];
    if (!allowedRoles.includes(newRole))
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 });

    // Check permissions: ADMIN or course's ADMIN
    const currentRoster = await prisma.roster.findFirst({
      where: { courseId, userId: currentUser.id },
    });
    const isAllowed = currentUser.role === 'ADMIN' || currentRoster?.role === 'INSTRUCTOR';
    if (!isAllowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    // Ensure roster entry exists
    const target = await prisma.roster.findFirst({
      where: { courseId, userId },
      select: { id: true, role: true },
    });
    if (!target) return NextResponse.json({ error: 'Roster entry not found' }, { status: 404 });

    // Prevent demoting the only faculty member
    if (target.role === 'INSTRUCTOR' && newRole !== 'INSTRUCTOR') {
      const instructorCount = await prisma.roster.count({
        where: { courseId, role: 'INSTRUCTOR' },
      });
      if (instructorCount <= 1) {
        return NextResponse.json(
          { error: 'Cannot demote the only course instructor' },
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
      category: 'COURSE',
      courseId,
      metadata: { userId: currentUser.id, courseId, targetUserId: userId, newRole },
    });

    return NextResponse.json({ success: true, roster: updated });
  } catch (err) {
    console.error('PATCH /api/courses/[id]/roster/[userId] error:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
