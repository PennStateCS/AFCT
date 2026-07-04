// /src/api/courses/[id]/archive/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { canArchiveCourse } from '@/lib/course-status-checks';

export async function PATCH(req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    // Extract params
    const { id: courseId } = await context.params;

    // Parse JSON body
    const { isArchived } = await req.json();

    // Validate input
    if (typeof isArchived !== 'boolean') {
      return NextResponse.json({ error: 'isArchived must be a boolean' }, { status: 400 });
    }

    // Get authenticated user session
    const session = await auth();
    const user = session?.user;

    // Allow only ADMIN or FACULTY to toggle archive status
    if (!user || !['ADMIN', 'FACULTY'].includes(user.role)) {
      await createEnhancedActivityLog(prisma, req, {
        userId: session?.user?.id ?? null,
        action: 'COURSE_ARCHIVE_DENIED',
        severity: 'SECURITY',
        metadata: { role: session?.user?.role ?? null },
      });
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // Centralized check for archiving (use DB dates to avoid client timezone drift)
    if (isArchived) {
      const courseDates = await prisma.course.findUnique({
        where: { id: courseId },
        select: { startDate: true, endDate: true },
      });
      if (!courseDates) {
        return NextResponse.json({ error: 'Course not found' }, { status: 404 });
      }

      const { canArchive, reason } = await canArchiveCourse(
        prisma,
        courseId,
        courseDates.startDate.toISOString(),
        courseDates.endDate.toISOString(),
      );
      if (!canArchive) {
        await createEnhancedActivityLog(prisma, req, {
          userId: session?.user?.id ?? null,
          action: 'COURSE_ARCHIVE_DENIED',
          severity: 'SECURITY',
          metadata: { role: session?.user?.role ?? null },
        });
        return NextResponse.json({ error: reason }, { status: 403 });
      }
    }

    // Update course archive status
    const updated = await prisma.course.update({
      where: { id: courseId },
      data: { isArchived },
      select: {
        id: true,
        name: true,
        code: true,
        isArchived: true,
        updatedAt: true,
      },
    });

    // Log the archive/notArchived event
    await createEnhancedActivityLog(prisma, req, {
      userId: user.id,
      action: isArchived ? 'COURSE_ARCHIVED' : 'COURSE_NOT_ARCHIVED',
      severity: 'INFO',
      category: 'COURSE',
      courseId,
      metadata: {
        userId: user.id,
        courseId: courseId,
        courseName: updated.name,
        isArchived: isArchived,
      },
    });

    // Respond with the updated course
    return NextResponse.json(updated);
  } catch (error) {
    console.error('Failed PATCH /api/courses/[id]/archive error:', error);
    await createEnhancedActivityLog(prisma, req, {
      userId: null,
      action: 'COURSE_ARCHIVE_ERROR',
      severity: 'ERROR',
      metadata: { error: error instanceof Error ? error.message : 'unknown error' },
    });
    return NextResponse.json('Failed to update archive status', { status: 500 });
  }
}
