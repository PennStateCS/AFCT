import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { withCourseAuth } from '@/lib/api/with-auth';
import { readJson } from '@/lib/api/request';
import { logError } from '@/lib/api/activity';
import { EnrollmentStatusChangeSchema } from '@/schemas/user';

/**
 * Drop or re-enroll a student in a course.
 *
 * A DROPPED student keeps their roster row and all their work (submissions, grades,
 * group membership, audience/override rows) but loses access: `canAccessCourse` denies
 * them, so they can't see or interact with the course, and it disappears from their own
 * lists. Staff review surfaces still show them, marked "Dropped". Re-enrolling flips
 * them back to ENROLLED and restores everything.
 *
 * This is distinct from removal (`DELETE .../roster/[userId]`): removal is a hard delete
 * for a student with no work; drop is the reversible action for a student who has work.
 * Only a global admin or a course FACULTY member may do it (TAs may not, matching the
 * other roster mutations), and it applies only to STUDENT rows.
 * @openapi
 * summary: Drop or re-enroll a student
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 *   - { name: userId, in: path, required: true, schema: { type: string } }
 * requestBody:
 *   required: true
 *   content:
 *     application/json:
 *       schema:
 *         type: object
 *         required: [status]
 *         properties:
 *           status: { type: string, enum: [ENROLLED, DROPPED] }
 * responses:
 *   200: { description: "Status updated (or already at the requested status)." }
 *   400: { description: "Invalid body, or the target is not a student." }
 *   401: { description: Not signed in. }
 *   403: { description: Caller is not a system admin or a course faculty member. }
 *   404: { description: Roster entry not found. }
 *   409: { description: Course is archived. }
 *   500: { description: Server error. }
 */
export const PATCH = withCourseAuth(
  async (req, ctx, { user, courseId }) => {
    const { userId } = await ctx.params;

    try {
      const parsed = await readJson(req, EnrollmentStatusChangeSchema);
      if (!parsed.ok) return parsed.response;
      const newStatus = parsed.data.status;

      const target = await prisma.roster.findFirst({
        where: { courseId, userId },
        select: { id: true, role: true, status: true },
      });
      if (!target) return NextResponse.json({ error: 'Roster entry not found' }, { status: 404 });

      // Status only applies to students; faculty/TA are always enrolled. This is a bad
      // target, not an authorization failure, so it's a 400 (the caller already passed
      // the FACULTY/admin gate).
      if (target.role !== 'STUDENT') {
        return NextResponse.json(
          { error: 'Only students can be dropped or re-enrolled' },
          { status: 400 },
        );
      }

      // Idempotent: already at the requested status is a success, not an error.
      if (target.status === newStatus) {
        return NextResponse.json({ success: true, status: newStatus, changed: false });
      }

      await prisma.roster.update({
        where: { id: target.id },
        // droppedAt records when a drop happened (for the retained record and the log);
        // clear it on re-enroll so a later drop stamps a fresh time.
        data: {
          status: newStatus,
          droppedAt: newStatus === 'DROPPED' ? new Date() : null,
        },
      });

      // Education-record event (who changed a student's standing, and when): logged with
      // the actor and subject at INFO. Keep the action names stable; they are research data.
      await createEnhancedActivityLog(prisma, req, {
        userId: user.id,
        action: newStatus === 'DROPPED' ? 'DROP_FROM_COURSE' : 'REENROLL_IN_COURSE',
        severity: 'INFO',
        category: 'COURSE',
        courseId,
        metadata: {
          targetUserId: userId,
          changes: { status: { from: target.status, to: newStatus } },
          previousStatus: target.status,
          newStatus,
        },
      });

      return NextResponse.json({ success: true, status: newStatus, changed: true });
    } catch (err) {
      console.error('PATCH /api/courses/[id]/roster/[userId]/status error:', err);
      await logError(req, {
        userId: user.id,
        action: 'ENROLLMENT_STATUS_ERROR',
        category: 'COURSE',
        error: err,
        courseId,
      });
      return NextResponse.json({ error: 'Server error' }, { status: 500 });
    }
  },
  {
    access: 'manage',
    roles: ['FACULTY'],
    blockWhenArchived: true,
    deniedAction: 'ENROLLMENT_STATUS_DENIED',
  },
);
