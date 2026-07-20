import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { logError } from '@/lib/api/activity';
import { withCourseAuth } from '@/lib/api/with-auth';
import { readJson } from '@/lib/api/request';
import { BulkEnrollUserIdsSchema } from '@/schemas/bulk';
import type { Prisma } from '@prisma/client';

/**
 * Enrolls many users as STUDENT in one transaction (the roster's bulk-add flow).
 * Course staff (faculty or TAs) or a system admin. Existing roster entries are
 * reset to STUDENT rather than duplicated, so it's safe to re-run. Every user is
 * added as a STUDENT regardless of any other role.
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

      // Enroll all users as STUDENT. Every row gets the same role, so this is two
      // set-based statements instead of one upsert per user: a 300-student paste was
      // 300 sequential round trips.
      //
      // `skipDuplicates` keeps the insert atomic against the (courseId, userId) unique
      // key, so a concurrent self-join creating the same row does not abort the batch
      // with a P2002. The updateMany then resets anyone who was already on the roster
      // under a different role, which is what makes re-running this safe. New rows are
      // already STUDENT, so it is harmless to include them.
      //
      // Note: do NOT "parallelize" this with Promise.all inside the transaction. An
      // interactive transaction runs on a single connection, so the queries serialize
      // anyway and interleaving them risks deadlock.
      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.roster.createMany({
          data: userIds.map((userId) => ({ courseId, userId, role: 'STUDENT' as const })),
          skipDuplicates: true,
        });
        await tx.roster.updateMany({
          where: { courseId, userId: { in: userIds } },
          data: { role: 'STUDENT' },
        });
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
