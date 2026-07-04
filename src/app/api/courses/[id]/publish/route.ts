// /src/api/courses/[id]/publish/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { canUnpublishCourse } from '@/lib/course-status-checks';

export async function PATCH(req: Request, context: { params: Promise<{ id: string }> }) {
  let actorId: string | null = null;
  try {
    // Extract course ID from route params
    const { id: courseId } = await context.params;

    // Parse JSON body
    const { isPublished } = await req.json();

    // Validate input
    if (typeof isPublished !== 'boolean') {
      return NextResponse.json({ error: 'isPublished must be a boolean' }, { status: 400 });
    }

    // Get authenticated user session
    const session = await auth();
    const user = session?.user;
    actorId = user?.id ?? null;

    // Allow only ADMIN or FACULTY to toggle publish status
    if (!user || !['ADMIN', 'FACULTY'].includes(user.role)) {
      await createEnhancedActivityLog(prisma, req, {
        userId: session?.user?.id ?? null,
        action: 'COURSE_PUBLISH_DENIED',
        severity: 'SECURITY',
        metadata: { role: session?.user?.role ?? null },
      });
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // Centralized check for unpublishing
    if (!isPublished) {
      const { canUnpublish, reason } = await canUnpublishCourse(prisma, courseId);
      if (!canUnpublish) {
        await createEnhancedActivityLog(prisma, req, {
          userId: session?.user?.id ?? null,
          action: 'COURSE_PUBLISH_DENIED',
          severity: 'SECURITY',
          metadata: { role: session?.user?.role ?? null },
        });
        return NextResponse.json({ error: reason }, { status: 403 });
      }
    }
     
    // Update course publish status
    const updated = await prisma.course.update({
      where: { id: courseId },
      data: { isPublished },
      select: {
        id: true,
        name: true,
        code: true,
        isPublished: true,
        updatedAt: true,
      },
    });

    // Log the publish/unpublish event
    await createEnhancedActivityLog(prisma, req, {
      userId: user.id,
      action: isPublished ? 'COURSE_PUBLISHED' : 'COURSE_UNPUBLISHED',
      severity: 'INFO',
      category: 'COURSE',
      courseId,
      metadata: {
        userId: user.id,
        courseId: courseId,
        courseName: updated.name,
        isPublished: isPublished,
      },
    });

    // Respond with the updated course
    return NextResponse.json(updated);
  } catch (error) {
    console.error('PATCH /api/courses/[id]/publish error:', error);
    await createEnhancedActivityLog(prisma, req, {
      userId: actorId,
      action: 'COURSE_PUBLISH_ERROR',
      severity: 'ERROR',
      metadata: { error: error instanceof Error ? error.message : 'unknown error' },
    });
    return new NextResponse('Failed to update publish status', { status: 500 });
  }
}
