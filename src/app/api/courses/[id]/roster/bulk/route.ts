import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getClientIp } from '@/lib/security/rate-limiter';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { logError } from '@/lib/api/activity';
import { withCourseAuth } from '@/lib/api/with-auth';
import { readJson } from '@/lib/api/request';
import { BulkEnrollUserIdsSchema } from '@/schemas/bulk';

/**
 * Bulk-adds users as STUDENT to a course roster (the roster's bulk-add flow).
 * Course staff (faculty or TAs) or a system admin. Purely additive: users not yet on
 * the roster are inserted as STUDENT and anyone already enrolled is left untouched, so
 * it's idempotent and safe to re-run. Changing an existing member's role is the
 * dedicated faculty-gated role-change endpoint's job.
 * @openapi
 * summary: Bulk-enroll students
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 * requestBody:
 *   required: true
 *   content:
 *     application/json:
 *       schema:
 *         type: object
 *         required: [userIds]
 *         properties:
 *           userIds: { type: array, items: { type: string } }
 * responses:
 *   200:
 *     description: Enrolled; returns how many.
 *     content:
 *       application/json:
 *         schema: { type: object, properties: { success: { type: boolean }, enrolled: { type: integer } } }
 *   400: { description: No users provided. }
 *   401: { description: Not signed in. }
 *   403: { description: Not course staff (faculty or TAs) or a system admin. }
 *   500: { description: Server error. }
 */
export const POST = withCourseAuth(
  async (req, _ctx, { user, courseId }) => {
    try {
      const parsed = await readJson(req, BulkEnrollUserIdsSchema);
      if (!parsed.ok) return parsed.response;
      const userIds: string[] = parsed.data.userIds.filter(Boolean);
      if (!userIds.length)
        return NextResponse.json({ error: 'No users provided' }, { status: 400 });

      // One set-based insert instead of an upsert per user: a 300-student paste was 300
      // sequential round trips. `skipDuplicates` makes it idempotent against the
      // (courseId, userId) unique key — new users are inserted as STUDENT and anyone
      // already on the roster is skipped, so a concurrent self-join can't abort the batch.
      //
      // Deliberately additive: we do NOT reset existing rows to STUDENT. That would let
      // any course staff (TAs included) silently demote a FACULTY/TA member, bypassing the
      // faculty-gated, last-faculty-guarded role-change route.
      // Who was already here, read before the insert. `skipDuplicates` returns a count rather
      // than the rows it wrote, so without this a paste that overlaps the roster would log an
      // enrolment for every name in it, including people who were already enrolled.
      const before = await prisma.roster.findMany({
        where: { courseId, userId: { in: userIds } },
        select: { userId: true, status: true, role: true },
      });
      const existing = new Map(before.map((row) => [row.userId, row]));

      await prisma.roster.createMany({
        data: userIds.map((userId) => ({ courseId, userId, role: 'STUDENT' as const })),
        skipDuplicates: true,
      });

      // Re-enroll any of these who were previously DROPPED: re-adding a dropped student
      // to the roster restores their access. Scoped to role STUDENT and status DROPPED so
      // it can never touch a FACULTY/TA row or change anyone's role (that stays the
      // faculty-gated role-change endpoint's job).
      const reEnrolled = await prisma.roster.updateMany({
        where: { courseId, userId: { in: userIds }, role: 'STUDENT', status: 'DROPPED' },
        data: { status: 'ENROLLED', droppedAt: null },
      });

      /**
       * One entry per student, then the summary, matching what the LMS roster sync does. The
       * per-student row is what answers "when was this student enrolled, and by whom".
       *
       * After the writes, so a failed audit cannot roll back an enrolment, and in one
       * `createMany`: the usual helper costs several queries per call.
       */
      const newlyEnrolled = userIds.filter((id) => !existing.has(id));
      const reEnrolledIds = userIds.filter((id) => existing.get(id)?.status === 'DROPPED');
      const ip = getClientIp(req);
      const userAgent = req.headers.get('user-agent') ?? null;

      const perStudent = [
        ...newlyEnrolled.map((targetUserId) => ({ targetUserId, action: 'ENROLL_USER' })),
        ...reEnrolledIds.map((targetUserId) => ({ targetUserId, action: 'REENROLL_IN_COURSE' })),
      ];

      if (perStudent.length > 0) {
        await prisma.activityLog.createMany({
          data: perStudent.map(({ targetUserId, action }) => ({
            userId: user.id,
            action,
            severity: 'INFO' as const,
            category: 'COURSE' as const,
            courseId,
            ipAddress: ip,
            userAgent,
            // `via` tells these apart from the same actions written by the LMS roster sync.
            metadata: { targetUserId, via: 'bulk-enroll' },
          })),
        });
      }

      await createEnhancedActivityLog(prisma, req, {
        userId: user.id,
        action: 'BULK_ENROLL_USERS',
        severity: 'INFO',
        category: 'COURSE',
        courseId,
        metadata: {
          courseId: courseId,
          // Both: what was requested is what the person did, what changed is what the course
          // did, and a paste that overlaps the roster makes them differ.
          requestedCount: userIds.length,
          enrolledIds: newlyEnrolled,
          enrolledCount: newlyEnrolled.length,
          reEnrolledCount: reEnrolled.count,
          alreadyEnrolledCount: userIds.length - newlyEnrolled.length - reEnrolledIds.length,
        },
      });
      return NextResponse.json({ success: true, enrolled: userIds.length }, { status: 200 });
    } catch (err) {
      console.error('bulk-enroll error', err);
      await logError(req, {
        userId: user.id,
        action: 'COURSE_BULK_ENROLL_ERROR',
        category: 'COURSE',
        error: err,
        courseId,
      });
      return NextResponse.json({ error: 'Server error' }, { status: 500 });
    }
  },
  { access: 'manage', blockWhenArchived: true, deniedAction: 'COURSE_BULK_ENROLL_DENIED' },
);
