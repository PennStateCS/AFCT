import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { readJson } from '@/lib/api/request';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { getClientIp, evaluatePasswordResetRateLimit } from '@/lib/security/rate-limiter';
import { requestPasswordReset } from '@/lib/password-reset';
import { canSendPasswordReset } from '@/lib/mailer';
import { RequestPasswordResetSchema } from '@/schemas/password';

/**
 * Asks for a password-reset link.
 *
 * Unauthenticated by necessity: whoever needs this cannot sign in. **The response is identical
 * every time**, whether the address has an account, belongs to a disabled one, or was never
 * heard of. Anything else makes this a way to ask whether a person has an account here, which
 * at a university is a roster nobody agreed to publish.
 *
 * That rule holds through every branch below, including rate limiting and send failures. The
 * only place the difference shows is the mailbox itself.
 * @openapi
 * summary: Request a password reset link
 * requestBody:
 *   required: true
 *   content:
 *     application/json:
 *       schema:
 *         type: object
 *         required: [email]
 *         properties:
 *           email: { type: string, format: email }
 * responses:
 *   200: { description: "Always, when the request is well formed. Reveals nothing about the address." }
 *   400: { description: Bad body. }
 *   503: { description: Email is not configured on this site. }
 */
export async function POST(req: Request) {
  const parsed = await readJson(req, RequestPasswordResetSchema);
  if (!parsed.ok) return parsed.response;
  const { email } = parsed.data;

  /**
   * Not a secret, and telling someone to contact an administrator is more useful than a
   * reassuring message about an email that is never coming.
   *
   * This now also covers a site that can reach a mail server but does not know its own address,
   * which used to send a link reading `/reset-password?token=...`. The reason is deliberately
   * not passed on: an administrator needs it, the person locked out does not, and it would
   * describe the server's configuration to anyone who asked.
   */
  const deliverable = await canSendPasswordReset();
  if (!deliverable.ok) {
    console.error('POST /api/auth/password-reset unavailable:', deliverable.reason);
    return NextResponse.json(
      {
        error:
          'This site cannot send email, so passwords cannot be reset this way. Contact an administrator.',
      },
      { status: 503 },
    );
  }

  const ip = getClientIp(req);
  const decision = evaluatePasswordResetRateLimit({ ip, identifier: email });

  // A blocked request still answers exactly like an allowed one. Saying "too many requests"
  // for one address and not another would leak the thing this endpoint exists to protect.
  if (decision.status !== 'blocked') {
    try {
      const { sent, kind } = await requestPasswordReset(email);
      await createEnhancedActivityLog(prisma, req, {
        userId: null,
        action: 'PASSWORD_RESET_REQUESTED',
        severity: 'INFO',
        category: 'USER',
        // The address is recorded because this is an account-recovery attempt and the log is
        // where an administrator would look after one. `queued` says whether a link was made
        // for it, which is what distinguishes a real request from a probe. It is not whether
        // the message was *delivered*: that happens later, and the mail queue records it.
        // `kind` distinguishes the two messages that can go out: a reset link, or an
        // explanation for an account that has no password to reset. The response is identical
        // either way, so the log is the only place the difference is visible.
        metadata: { email, queued: sent, kind: kind ?? null },
      });
    } catch (error) {
      // A mail failure is ours, not the caller's, and telling them would also tell them the
      // address exists. Log it and answer normally.
      console.error('POST /api/auth/password-reset error:', error);
      await createEnhancedActivityLog(prisma, req, {
        userId: null,
        action: 'PASSWORD_RESET_SEND_FAILED',
        severity: 'ERROR',
        category: 'SYSTEM',
        metadata: { email, reason: error instanceof Error ? error.message : 'unknown' },
      }).catch(() => {});
    }
  }

  return NextResponse.json({
    message: 'If that address has an account, a reset link is on its way.',
  });
}
