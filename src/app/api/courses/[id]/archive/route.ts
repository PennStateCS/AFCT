import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { logError } from '@/lib/api/activity';
import { z } from 'zod';
import { canArchiveCourse } from '@/lib/course-status-checks';
import { isAdmin, COURSE_STAFF_ROLES } from '@/lib/permissions';
import { withCourseAuth } from '@/lib/api/with-auth';
import { readJson } from '@/lib/api/request';

const ArchiveBody = z.object({ isArchived: z.boolean() });

/**
 * Toggles a course's archived state. **Both archiving and un-archiving are
 * admin-only** — freezing a course (or reopening a frozen one to edits) is a
 * privileged action. Archiving also runs a safety check (canArchiveCourse) using
 * the course's stored dates rather than any client value, to avoid timezone drift
 * deciding whether a course has really ended.
 * @openapi
 * summary: Archive or unarchive a course
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 * requestBody:
 *   required: true
 *   content:
 *     application/json:
 *       schema:
 *         type: object
 *         required: [isArchived]
 *         properties:
 *           isArchived: { type: boolean }
 * responses:
 *   200:
 *     description: The updated course (id, name, code, isArchived, updatedAt).
 *   400: { description: isArchived must be a boolean. }
 *   401: { description: Not signed in. }
 *   403: { description: "Not an admin, or archiving is blocked by the safety check." }
 *   404: { description: Course not found. }
 *   500: { description: Server error. }
 */
export const PATCH = withCourseAuth(
  async (req, _ctx, { user, courseId }) => {
    try {
      const parsed = await readJson(req, ArchiveBody);
      if (!parsed.ok) return parsed.response;
      const { isArchived } = parsed.data;

      // Archiving and un-archiving are both admin-only. The wrapper lets course staff
      // reach the route, so enforce the admin requirement here.
      if (!isAdmin(user)) {
        await createEnhancedActivityLog(prisma, req, {
          userId: user.id,
          action: 'COURSE_ARCHIVE_DENIED',
          severity: 'SECURITY',
          courseId,
          metadata: { reason: 'archive/un-archive is admin-only', isArchived },
        });
        return NextResponse.json(
          { error: 'Only an admin can archive or restore a course' },
          { status: 403 },
        );
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
            userId: user.id,
            action: 'COURSE_ARCHIVE_DENIED',
            severity: 'SECURITY',
            metadata: {},
          });
          return NextResponse.json({ error: reason }, { status: 403 });
        }
      }

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

      return NextResponse.json(updated);
    } catch (error) {
      console.error('Failed PATCH /api/courses/[id]/archive error:', error);
      await logError(req, {
        userId: user.id,
        action: 'COURSE_ARCHIVE_ERROR',
        error,
      });
      return NextResponse.json({ error: 'Failed to update archive status' }, { status: 500 });
    }
  },
  // Staff (faculty OR TA) or admin may reach the route, but the handler restricts
  // both archiving and un-archiving to admins.
  { access: 'manage', roles: COURSE_STAFF_ROLES, deniedAction: 'COURSE_ARCHIVE_DENIED' },
);
