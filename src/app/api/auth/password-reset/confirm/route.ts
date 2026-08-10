import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { readJson } from '@/lib/api/request';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { getClientIp, evaluatePasswordResetRateLimit } from '@/lib/security/rate-limiter';
import { completePasswordReset } from '@/lib/password-reset';
import { CompletePasswordResetSchema } from '@/schemas/password';

/**
 * Follows a reset link and sets a new password.
 *
 * Unauthenticated, because the token is the authentication. Succeeding here ends every existing
 * session and refuses every client token issued earlier, on the reasoning that a reset usually
 * means the account was compromised and a stolen token that outlives it defeats the point.
 * @openapi
 * summary: Complete a password reset
 * requestBody:
 *   required: true
 *   content:
 *     application/json:
 *       schema:
 *         type: object
 *         required: [token, newPassword, confirmNewPassword]
 *         properties:
 *           token: { type: string }
 *           newPassword: { type: string }
 *           confirmNewPassword: { type: string }
 * responses:
 *   200: { description: The password was changed. }
 *   400: { description: "Bad body, or the link is invalid, expired or already used." }
 *   500: { description: Server error. }
 */
export async function POST(req: Request) {
  const parsed = await readJson(req, CompletePasswordResetSchema);
  if (!parsed.ok) return parsed.response;
  const { token, newPassword } = parsed.data;

  // Guessing a token is not realistic, but a limit here costs nothing and stops someone
  // hammering the endpoint on the chance that it is.
  const decision = evaluatePasswordResetRateLimit({ ip: getClientIp(req) });
  if (decision.status === 'blocked') {
    return NextResponse.json(
      { error: 'Too many attempts. Wait a few minutes and try again.' },
      { status: 429 },
    );
  }

  try {
    const result = await completePasswordReset(token, newPassword);

    if (!result.ok) {
      await createEnhancedActivityLog(prisma, req, {
        userId: null,
        action: 'PASSWORD_RESET_REJECTED',
        severity: 'WARNING',
        category: 'USER',
        metadata: { reason: 'invalid or expired link' },
      });
      // One message for unknown, expired and already-used. Telling them apart would say
      // whether a token ever existed, and it makes no difference to what the person does next.
      return NextResponse.json(
        {
          error:
            'This reset link is no longer valid. It may have expired or already been used. Request a new one.',
        },
        { status: 400 },
      );
    }

    await createEnhancedActivityLog(prisma, req, {
      userId: result.userId,
      action: 'PASSWORD_RESET_COMPLETED',
      severity: 'INFO',
      category: 'USER',
      // The subject is also the actor here: nobody else acted on this account.
      metadata: { targetUserId: result.userId },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('POST /api/auth/password-reset/confirm error:', error);
    return NextResponse.json(
      { error: 'Could not reset the password. Try again.' },
      { status: 500 },
    );
  }
}
