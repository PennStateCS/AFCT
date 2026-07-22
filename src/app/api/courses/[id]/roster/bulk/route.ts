import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
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
      await prisma.roster.createMany({
        data: userIds.map((userId) => ({ courseId, userId, role: 'STUDENT' as const })),
        skipDuplicates: true,
      });

      // Log bulk enrollment action
      await createEnhancedActivityLog(prisma, req, {
        userId: user.id,
        action: 'BULK_ENROLL_USERS',
        severity: 'INFO',
        category: 'COURSE',
        courseId,
        metadata: {
          courseId: courseId,
          enrolledIds: userIds,
          enrolledCount: userIds.length,
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
