import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { logError } from '@/lib/api/activity';
import { withCourseAuth } from '@/lib/api/with-auth';
import { readJson } from '@/lib/api/request';

const EnrollBody = z.object({ userId: z.string().min(1, 'Missing userId') });

/**
 * Adds (or re-roles) a single user on a course roster. Course staff (faculty or
 * TAs) or a system admin. The user is always added as a STUDENT; callers don't
 * pick the role directly. Upserts, so re-enrolling just resets the role to STUDENT.
 * @openapi
 * summary: Enroll a user in a course
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 * requestBody:
 *   required: true
 *   content:
 *     application/json:
 *       schema:
 *         type: object
 *         required: [userId]
 *         properties:
 *           userId: { type: string }
 * responses:
 *   200:
 *     description: Enrolled.
 *     content:
 *       application/json:
 *         schema: { type: object, properties: { success: { type: boolean } } }
 *   400: { description: Missing userId. }
 *   401: { description: Not signed in. }
 *   403: { description: Not course staff (faculty or TAs) or a system admin. }
 *   404: { description: Target user not found. }
 *   409: { description: The target user is inactive. }
 *   500: { description: Server error. }
 */
export const POST = withCourseAuth(
  async (req, _ctx, { user, courseId }) => {
    try {
      const parsed = await readJson(req, EnrollBody);
      if (!parsed.ok) return parsed.response;
      const { userId } = parsed.data;

      const targetUser = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, inactive: true },
      });

      if (!targetUser) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
      }

      if (targetUser.inactive == true) {
        // The caller is authorized; it's the enrollment target that's disabled.
        // 409 (conflict), not 401, which would look like the caller is signed out.
        return NextResponse.json({ error: 'User is inactive' }, { status: 409 });
      }

      const roleToAssign = 'STUDENT';

      await prisma.roster.upsert({
        where: {
          courseId_userId: {
            courseId,
            userId,
          },
        },
        create: {
          courseId,
          userId,
          role: roleToAssign,
        },
        update: {
          role: roleToAssign,
        },
      });

      await createEnhancedActivityLog(prisma, req, {
        userId: user.id,
        action: 'ENROLL_USER',
        severity: 'INFO',
        category: 'COURSE',
        courseId,
        metadata: {
          courseId: courseId,
          enrolledUserId: userId,
          role: roleToAssign,
        },
      });

      return NextResponse.json({ success: true });
    } catch (error) {
      console.error('Enrollment error:', error);
      await logError(req, {
        userId: user.id,
        action: 'COURSE_ENROLL_ERROR',
        category: 'COURSE',
        error,
        courseId,
      });
      return NextResponse.json({ error: 'Failed to enroll user' }, { status: 500 });
    }
  },
  { access: 'manage', blockWhenArchived: true, deniedAction: 'COURSE_ENROLL_DENIED' },
);
