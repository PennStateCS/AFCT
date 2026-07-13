import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcrypt';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { logError } from '@/lib/api/activity';
import { isStrongPassword, passwordRequirementText } from '@/lib/password-policy';
import { withAdminAuth } from '@/lib/api/with-auth';
import { readJson } from '@/lib/api/request';

const ResetPasswordBody = z.object({
  userId: z.string().min(1),
  newPassword: z.string().min(1),
  isTemporary: z.boolean().optional().default(false),
});

/**
 * Sets another user's password on their behalf (an admin-initiated reset).
 * System administrators only; the new password still has to meet the strength
 * policy. Pass `isTemporary` to force a change at next login. The plaintext
 * password is never logged — only who reset whom.
 * @openapi
 * summary: Reset a user's password (admin)
 * requestBody:
 *   required: true
 *   content:
 *     application/json:
 *       schema:
 *         type: object
 *         required: [userId, newPassword]
 *         properties:
 *           userId: { type: string, description: The user whose password is being reset }
 *           newPassword: { type: string, description: Must meet the strength policy }
 *           isTemporary: { type: boolean, description: Force a change at next login (default false) }
 * responses:
 *   200:
 *     description: Password reset.
 *     content:
 *       application/json:
 *         schema: { type: object, properties: { success: { type: boolean } } }
 *   400: { description: Missing fields or weak password. }
 *   403: { description: Caller is not a system administrator. }
 *   500: { description: Reset failed. }
 */
export const POST = withAdminAuth(
  async (req, _ctx, { user }) => {
    const parsed = await readJson(req, ResetPasswordBody);
    if (!parsed.ok) return parsed.response;
    const { userId, newPassword, isTemporary } = parsed.data;

    if (!isStrongPassword(newPassword)) {
      return NextResponse.json({ error: passwordRequirementText }, { status: 400 });
    }

    try {
      const hashedPassword = await bcrypt.hash(newPassword, 10);

      await prisma.user.update({
        where: { id: userId },
        data: { password: hashedPassword, temporaryPassword: Boolean(isTemporary) },
      });

      await createEnhancedActivityLog(prisma, req, {
        userId: user.id,
        action: 'RESET_PASSWORD',
        severity: 'INFO',
        category: 'USER',
        metadata: {
          targetUserId: userId,
          temporaryPassword: Boolean(isTemporary),
        },
      });

      return NextResponse.json({ success: true });
    } catch (error) {
      console.error('Reset password error:', error);
      await logError(req, {
        userId: user.id,
        action: 'ADMIN_RESET_PASSWORD_ERROR',
        error,
      });
      return NextResponse.json({ error: 'Failed to reset password' }, { status: 500 });
    }
  },
  { deniedAction: 'ADMIN_RESET_PASSWORD_DENIED' },
);
