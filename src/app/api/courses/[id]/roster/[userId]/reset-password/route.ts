import { NextResponse } from 'next/server';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import { prisma } from '@/lib/prisma';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { withCourseAuth } from '@/lib/api/with-auth';
import { readJson } from '@/lib/api/request';
import { logDenial, logError } from '@/lib/api/activity';
import { isStrongPassword, passwordRequirementText } from '@/lib/password-policy';
import { invalidateSessionUser } from '@/lib/session-user-cache';

const ResetBody = z.object({
  newPassword: z.string().min(1),
  isTemporary: z.boolean().optional().default(false),
});

/**
 * Course-staff password reset for a student on the roster. This is a stop-gap for
 * small deployments so course staff can help a student who is locked out, without
 * a system administrator. Permission is tiered: the wrapper admits course FACULTY
 * and TAs (and global admins); this handler additionally requires the target to be
 * a STUDENT enrolled in THIS course. It refuses to reset a staff member, a global
 * administrator, or anyone not on this roster, so it can never be used to seize a
 * privileged account. System-wide resets stay on the admin User Accounts page.
 *
 * Not blocked on an archived course: a student may still need to sign in to review
 * past work, and the reset touches the user account, not course content.
 * @openapi
 * summary: Reset a student's password (course staff)
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 *   - { name: userId, in: path, required: true, schema: { type: string } }
 * requestBody:
 *   required: true
 *   content:
 *     application/json:
 *       schema:
 *         type: object
 *         required: [newPassword]
 *         properties:
 *           newPassword: { type: string, description: Must meet the strength policy }
 *           isTemporary: { type: boolean, description: Force a change at next login (default false) }
 * responses:
 *   200:
 *     description: Password reset.
 *     content:
 *       application/json:
 *         schema: { type: object, properties: { success: { type: boolean } } }
 *   400: { description: Missing fields or weak password. }
 *   401: { description: Not signed in. }
 *   403: { description: "Caller is not course staff, or the target is not a student on this roster." }
 *   404: { description: Target user is not on this course roster. }
 *   500: { description: Reset failed. }
 */
export const POST = withCourseAuth(
  async (req, ctx, { user, courseId }) => {
    const { userId } = await ctx.params;
    if (!userId) {
      return NextResponse.json({ error: 'Missing user id' }, { status: 400 });
    }

    // The wrapper admitted course FACULTY, TAs, and global admins. The remaining
    // rule: the target must be a plain STUDENT on this course's roster. Never reset
    // a staff member or a global administrator, even if they happen to be enrolled.
    const targetRoster = await prisma.roster.findFirst({
      where: { courseId, userId },
      select: { role: true, user: { select: { isAdmin: true } } },
    });

    if (!targetRoster) {
      return NextResponse.json({ error: 'User is not on this course roster' }, { status: 404 });
    }

    if (targetRoster.role !== 'STUDENT' || targetRoster.user.isAdmin) {
      return logDenial(req, {
        userId: user.id,
        action: 'ROSTER_RESET_PASSWORD_DENIED',
        category: 'COURSE',
        courseId,
        metadata: { targetUserId: userId, targetRole: targetRoster.role },
      });
    }

    const parsed = await readJson(req, ResetBody);
    if (!parsed.ok) return parsed.response;
    const { newPassword, isTemporary } = parsed.data;

    if (!isStrongPassword(newPassword)) {
      return NextResponse.json({ error: passwordRequirementText }, { status: 400 });
    }

    try {
      const hashedPassword = await bcrypt.hash(newPassword, 10);

      await prisma.user.update({
        where: { id: userId },
        data: {
          password: hashedPassword,
          temporaryPassword: Boolean(isTemporary),
          passwordChangedAt: new Date(),
        },
      });
      // A reset must terminate the student's existing sessions immediately, so drop the
      // cached session row rather than waiting for it to expire.
      invalidateSessionUser(userId);

      await createEnhancedActivityLog(prisma, req, {
        userId: user.id,
        action: 'RESET_STUDENT_PASSWORD',
        severity: 'INFO',
        category: 'COURSE',
        courseId,
        metadata: {
          targetUserId: userId,
          temporaryPassword: Boolean(isTemporary),
        },
      });

      return NextResponse.json({ success: true });
    } catch (error) {
      console.error('Course reset password error:', error);
      await logError(req, {
        userId: user.id,
        action: 'ROSTER_RESET_PASSWORD_ERROR',
        category: 'COURSE',
        error,
      });
      return NextResponse.json({ error: 'Failed to reset password' }, { status: 500 });
    }
  },
  { access: 'manage', deniedAction: 'ROSTER_RESET_PASSWORD_DENIED' },
);
