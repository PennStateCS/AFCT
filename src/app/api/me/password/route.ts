import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcrypt';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { logError } from '@/lib/api/activity';
import { isStrongPassword, passwordRequirementText } from '@/lib/password-policy';
import { readJson } from '@/lib/api/request';

const ChangePasswordBody = z.object({
  oldPassword: z.string().min(1),
  newPassword: z.string().min(1),
});

/**
 * Lets a signed-in user change their own password. Requires the current password,
 * enforces the strength policy, and forbids reusing the existing one. A correct
 * change also clears the `temporaryPassword` flag (used after admin resets).
 * @openapi
 * summary: Change my password
 * requestBody:
 *   required: true
 *   content:
 *     application/json:
 *       schema:
 *         type: object
 *         required: [oldPassword, newPassword]
 *         properties:
 *           oldPassword: { type: string }
 *           newPassword: { type: string, description: Must meet the strength policy and differ from the old one }
 * responses:
 *   200:
 *     description: Password updated.
 *     content:
 *       application/json:
 *         schema:
 *           type: object
 *           properties:
 *             success: { type: boolean }
 *             message: { type: string }
 *   400: { description: "Missing fields, weak password, wrong current password, or reused password." }
 *   401: { description: Not signed in. }
 *   404: { description: User record not found. }
 *   500: { description: Server error. }
 */
export async function POST(req: NextRequest) {
  let actorId: string | null = null;
  try {
    const session = await auth();

    if (!session?.user?.id || session.user.inactive) {
      console.warn('[CHANGE_PASSWORD] Unauthorized access attempt');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = session.user.id;
    actorId = userId;

    const parsed = await readJson(req, ChangePasswordBody);
    if (!parsed.ok) return parsed.response;
    const { oldPassword, newPassword } = parsed.data;

    if (!isStrongPassword(newPassword)) {
      console.warn('[CHANGE_PASSWORD] New password does not meet policy');
      return NextResponse.json({ error: passwordRequirementText }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { password: true, temporaryPassword: true },
    });

    if (!user?.password) {
      console.error('[CHANGE_PASSWORD] User not found in database');
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const isValid = await bcrypt.compare(oldPassword, user.password);
    if (!isValid) {
      console.warn(`[CHANGE_PASSWORD] Incorrect old password for user ${userId}`);
      // A logged-in session that can't produce the current password is a security
      // signal (possible session misuse), not just a validation error.
      await createEnhancedActivityLog(prisma, req, {
        userId,
        action: 'CHANGE_PASSWORD_FAILED',
        severity: 'SECURITY',
        category: 'USER',
        metadata: { reason: 'incorrect current password' },
      });
      return NextResponse.json({ error: 'Incorrect old password' }, { status: 400 });
    }

    // Reject reuse of the current password.
    const isSameAsOld = await bcrypt.compare(newPassword, user.password);
    if (isSameAsOld) {
      console.warn('[CHANGE_PASSWORD] New password is same as old');
      return NextResponse.json(
        { error: 'New password cannot be the same as the old password' },
        { status: 400 },
      );
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Clearing temporaryPassword retires any admin-issued reset.
    await prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword, temporaryPassword: false },
    });

    await createEnhancedActivityLog(prisma, req, {
      userId,
      action: 'CHANGE_PASSWORD',
      severity: 'INFO',
      category: 'USER',
      metadata: {
        wasTemporaryPassword: Boolean(user.temporaryPassword),
      },
    });

    return NextResponse.json({ success: true, message: 'Password updated successfully' });
  } catch (err) {
    console.error('[CHANGE_PASSWORD_ERROR]', err);
    await logError(req, {
      userId: actorId,
      action: 'CHANGE_PASSWORD_ERROR',
      error: err,
    });
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
