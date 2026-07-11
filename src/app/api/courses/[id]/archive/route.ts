import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { logError } from '@/lib/api/activity';
import { canArchiveCourse } from '@/lib/course-status-checks';
import { isAdmin, COURSE_STAFF_ROLES } from '@/lib/permissions';
import { withCourseAuth } from '@/lib/api/with-auth';

/**
 * Toggles a course's archived state. **Archiving** is allowed for course staff
 * (faculty or TA) or a system admin; **un-archiving is admin-only** — reopening a
 * frozen course to edits is a privileged action. Archiving runs a safety check
 * (canArchiveCourse) using the course's stored dates rather than any client value, to
 * avoid timezone drift deciding whether a course has really ended.
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
 *   403: { description: "Not permitted (staff may archive; only an admin may un-archive), or archiving is blocked by the safety check." }
 *   404: { description: Course not found. }
 *   500: { description: Server error. }
 */
export const PATCH = withCourseAuth(
  async (req, _ctx, { user, courseId }) => {
    try {
      const { isArchived } = await req.json();
      if (typeof isArchived !== 'boolean') {
        return NextResponse.json({ error: 'isArchived must be a boolean' }, { status: 400 });
      }

      // Un-archiving reopens a frozen course to edits — admin-only. Staff may archive
      // (the wrapper already confirmed staff/admin) but must not un-archive.
      if (!isArchived && !isAdmin(user)) {
        await createEnhancedActivityLog(prisma, req, {
          userId: user.id,
          action: 'COURSE_ARCHIVE_DENIED',
          severity: 'SECURITY',
          courseId,
          metadata: { reason: 'un-archive is admin-only' },
        });
        return NextResponse.json({ error: 'Only an admin can un-archive a course' }, { status: 403 });
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
  // Staff (faculty OR TA) or admin may reach the route — archiving is a staff-tier
  // action (TAs are the same tier as faculty), stated explicitly. The handler
  // further restricts un-archiving to admins.
  { access: 'manage', roles: COURSE_STAFF_ROLES, deniedAction: 'COURSE_ARCHIVE_DENIED' },
);
