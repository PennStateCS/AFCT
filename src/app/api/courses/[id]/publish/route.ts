import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { canUnpublishCourse } from '@/lib/course-status-checks';
import { canManageCourse, COURSE_FACULTY_ROLES } from '@/lib/permissions';

/**
 * Toggles a course's published state. ADMIN/FACULTY only. Unpublishing runs a
 * safety check (canUnpublishCourse) that refuses if students would lose access to
 * work already in progress.
 * @openapi
 * summary: Publish or unpublish a course
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 * requestBody:
 *   required: true
 *   content:
 *     application/json:
 *       schema:
 *         type: object
 *         required: [isPublished]
 *         properties:
 *           isPublished: { type: boolean }
 * responses:
 *   200:
 *     description: The updated course (id, name, code, isPublished, updatedAt).
 *   400: { description: isPublished must be a boolean. }
 *   403: { description: "Not staff, or unpublishing is blocked by the safety check." }
 *   500: { description: Server error. }
 */
export async function PATCH(req: Request, context: { params: Promise<{ id: string }> }) {
  let actorId: string | null = null;
  try {
    const { id: courseId } = await context.params;

    const { isPublished } = await req.json();
    if (typeof isPublished !== 'boolean') {
      return NextResponse.json({ error: 'isPublished must be a boolean' }, { status: 400 });
    }

    const session = await auth();
    const user = session?.user;
    actorId = user?.id ?? null;

    if (!user?.id || !(await canManageCourse(user, courseId, COURSE_FACULTY_ROLES))) {
      await createEnhancedActivityLog(prisma, req, {
        userId: session?.user?.id ?? null,
        action: 'COURSE_PUBLISH_DENIED',
        severity: 'SECURITY',
        metadata: {},
      });
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    if (!isPublished) {
      const { canUnpublish, reason } = await canUnpublishCourse(prisma, courseId);
      if (!canUnpublish) {
        await createEnhancedActivityLog(prisma, req, {
          userId: session?.user?.id ?? null,
          action: 'COURSE_PUBLISH_DENIED',
          severity: 'SECURITY',
          metadata: {},
        });
        return NextResponse.json({ error: reason }, { status: 403 });
      }
    }

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
