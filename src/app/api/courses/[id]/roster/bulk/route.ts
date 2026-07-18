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

      // Enroll all users as STUDENT. Upsert on the (courseId, userId) unique key is
      // atomic against the constraint, so a concurrent self-join creating the same
      // row no longer aborts the whole batch with a P2002 (the old findFirst+create
      // was a check-then-act race).
      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        for (const uid of userIds) {
          await tx.roster.upsert({
            where: { courseId_userId: { courseId, userId: uid } },
            create: { courseId, userId: uid, role: 'STUDENT' },
            update: { role: 'STUDENT' },
          });
        }
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
