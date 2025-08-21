import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';

export async function DELETE(req: NextRequest, context: { params: Promise<{ id: string; userId: string }> }) {
  const { id: courseId, userId } = await context.params;

  try {
    const session = await auth();
    const currentUser = session?.user;

    if (!currentUser || !['ADMIN', 'FACULTY', 'TA'].includes(currentUser.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

  // Prevent removal if the user has any submissions in this course
    const assignmentIds = await prisma.assignment.findMany({ where: { courseId }, select: { id: true } });
    const assignmentIdList = assignmentIds.map((a) => a.id);

    if (assignmentIdList.length > 0) {
      const existingSubmission = await prisma.submission.findFirst({
        where: {
          studentId: userId,
          assignmentId: { in: assignmentIdList },
        },
      });

      if (existingSubmission) {
        return NextResponse.json({ error: 'User has submissions for this course and cannot be removed' }, { status: 400 });
      }
    }

    // Prevent removing the only faculty member from a course
    // Check whether the user to remove is a faculty member on the roster
    const rosterEntry = await prisma.roster.findFirst({ where: { courseId, userId }, select: { role: true } });
    if (rosterEntry && rosterEntry.role === 'FACULTY') {
      const facultyCount = await prisma.roster.count({ where: { courseId, role: 'FACULTY' } });
      if (facultyCount <= 1) {
        return NextResponse.json({ error: 'Cannot remove the only faculty member from the course' }, { status: 400 });
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
      metadata: { removedUserId: userId, count: deleted.count },
    });

    return NextResponse.json({ success: true, removed: deleted.count });
  } catch (err) {
    console.error('DELETE /api/courses/[id]/roster/[userId] error:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
