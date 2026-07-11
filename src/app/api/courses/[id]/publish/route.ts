import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { logError } from '@/lib/api/activity';
import { z } from 'zod';
import { canUnpublishCourse } from '@/lib/course-status-checks';
import { COURSE_STAFF_ROLES } from '@/lib/permissions';
import { withCourseAuth } from '@/lib/api/with-auth';
import { readJson } from '@/lib/api/request';

const PublishBody = z.object({ isPublished: z.boolean() });

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
      const parsed = await readJson(req, PublishBody);
      if (!parsed.ok) return parsed.response;
      const { isPublished } = parsed.data;

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
  // Course staff (faculty OR TA) or admin. TAs are the same tier as faculty here,
  // so publish/unpublish is a staff action — stated explicitly rather than relying
  // on the default role set.
  {
    access: 'manage',
    roles: COURSE_STAFF_ROLES,
    deniedAction: 'COURSE_PUBLISH_DENIED',
    blockWhenArchived: true,
  },
);
