import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyCredentials } from '@/lib/credentials';
import { linkIdentity } from '@/lib/linked-identity';
import { issueSingleUseToken } from '@/lib/single-use-token';
import { publicUrl } from '@/lib/lti/public-url';
import { getClientIp } from '@/lib/ip-utils';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';

/**
 * An administrator confirming, with their AFCT password, that an LMS account is theirs.
 *
 * The account is never taken from this form. It comes from the pending row the launch wrote,
 * which holds the issuer and subject the platform signed. All this request supplies is a
 * password, so the worst a stolen pending id can do is offer somebody a password prompt for an
 * account they cannot pass.
 *
 * The password is checked by `verifyCredentials`, the same path the login form uses, so this
 * inherits its rate limiting, lockout policy and bot challenge. Checking a hash here instead
 * would quietly build an unthrottled password oracle that also announces which addresses are
 * administrators.
 */

/** Matches the launch ticket: long enough to spend immediately, no longer. */
const TICKET_TTL_MS = 60 * 1000;

/** Back to the form, saying only that it did not work. */
function retry(request: Request, pendingId: string) {
  const back = new URL(publicUrl('/lti/confirm', request));
  back.searchParams.set('pending', pendingId);
  back.searchParams.set('error', '1');
  return NextResponse.redirect(back, 303);
}

function expired(request: Request) {
  const back = new URL(publicUrl('/lti/confirm', request));
  return NextResponse.redirect(back, 303);
}

/**
 * @openapi
 * summary: Confirm an administrator's password and attach their LMS account
 * responses:
 *   303: { description: "Signed in and sent on, or back to the form when the password was refused." }
 */
export async function POST(request: Request) {
  const form = await request.formData();
  const pendingId = String(form.get('pendingId') ?? '');
  const password = String(form.get('password') ?? '');

  const pending = pendingId
    ? await prisma.ltiPendingIdentityLink.findFirst({
        where: { id: pendingId, expiresAt: { gt: new Date() } },
        select: {
          id: true,
          issuer: true,
          subject: true,
          userId: true,
          next: true,
          user: { select: { email: true } },
        },
      })
    : null;

  if (!pending) return expired(request);

  const verified = await verifyCredentials({
    email: pending.user.email,
    password,
    ipAddress: getClientIp(request),
  });

  if (!verified.ok || verified.user.id !== pending.userId) {
    // No detail, deliberately: the caller holds a launch, not proof of who they are.
    return retry(request, pending.id);
  }

  /**
   * `SELF_SERVICE`, because that is what happened: the person holding the account asked for it.
   * The guardrail that refuses administrators applies to the automatic methods, and this is no
   * longer one of them, which is the whole point of the password.
   */
  const linked = await linkIdentity({
    ref: { kind: 'LTI', issuer: pending.issuer, subject: pending.subject },
    userId: pending.userId,
    via: 'SELF_SERVICE',
    actorUserId: pending.userId,
    context: request,
  });
  if (!linked.ok) return retry(request, pending.id);

  // An administrator account gaining a new way to sign in is exactly what somebody reviewing
  // the log later is looking for, so it is recorded as a security event in its own right,
  // separate from the link the helper already logged.
  await createEnhancedActivityLog(prisma, request, {
    userId: pending.userId,
    action: 'LTI_ADMIN_IDENTITY_CONFIRMED',
    severity: 'SECURITY',
    category: 'USER',
    metadata: { issuer: pending.issuer, targetUserId: pending.userId },
  });

  // Single use: a confirmation that has been spent must not be replayable.
  await prisma.ltiPendingIdentityLink.delete({ where: { id: pending.id } });

  const { token: ticket } = await issueSingleUseToken({
    purpose: 'LTI_SESSION_TICKET',
    userId: pending.userId,
    ttlMs: TICKET_TTL_MS,
  });

  const next = new URL(publicUrl('/lti/complete', request));
  next.searchParams.set('ticket', ticket);
  // Only ever a path this launch chose, never anything from the form.
  next.searchParams.set('next', pending.next ?? '/dashboard');
  return NextResponse.redirect(next, 303);
}
