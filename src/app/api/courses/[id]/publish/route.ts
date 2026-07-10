import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { logError } from '@/lib/api/activity';
import { canUnpublishCourse } from '@/lib/course-status-checks';
import { withCourseAuth } from '@/lib/api/with-auth';

/**
 * Toggles a course's published state. Course staff (faculty or TA) or a system admin.
 * Unpublishing runs a
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
 *   401: { description: Not signed in. }
 *   403: { description: "Not course staff or a system admin, or unpublishing is blocked by the safety check." }
 *   500: { description: Server error. }
 */
export const PATCH = withCourseAuth(
  async (req, _ctx, { user, courseId }) => {
    try {
      const { isPublished } = await req.json();
      if (typeof isPublished !== 'boolean') {
        return NextResponse.json({ error: 'isPublished must be a boolean' }, { status: 400 });
      }

      if (!isPublished) {
        const { canUnpublish, reason } = await canUnpublishCourse(prisma, courseId);
        if (!canUnpublish) {
          await createEnhancedActivityLog(prisma, req, {
            userId: user.id,
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
      await logError(req, {
        userId: user.id,
        action: 'COURSE_PUBLISH_ERROR',
        error,
      });
      return NextResponse.json({ error: 'Failed to update publish status' }, { status: 500 });
    }
  },
  // Course staff (faculty or TA) or admin — the default role set. TA = faculty.
  { access: 'manage', deniedAction: 'COURSE_PUBLISH_DENIED', blockWhenArchived: true },
);
