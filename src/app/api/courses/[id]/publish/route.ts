// /src/api/courses/[id]/publish/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { canUnpublishCourse } from '@/lib/course-status-checks';

export async function PATCH(req: Request, context: { params: Promise<{ id: string }> }) {
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

    // Allow only ADMIN or FACULTY to toggle publish status
    if (!user || !['ADMIN', 'FACULTY'].includes(user.role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // Centralized check for unpublishing
    if (!isPublished) {
      const { canUnpublish, reason } = await canUnpublishCourse(prisma, courseId);
      if (!canUnpublish) {
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
    return new NextResponse('Failed to update publish status', { status: 500 });
  }
}
