/**
 * Password reset by email.
 *
 * The rules live here rather than in the two routes, because most of them are about what must
 * *not* happen and they are easy to get subtly wrong in one place and not the other.
 *
 * The governing rule: **the request endpoint answers identically every time.** Whether the
 * address has an account, is disabled, or was never heard of, the caller sees the same thing.
 * Anything else turns this into a way to ask "does this person have an account here", which for
 * a university is a roster nobody agreed to publish.
 *
 * That is also why "tell someone how their account signs in" happens in the email rather than on
 * the page: the email only reaches the person who owns the mailbox.
 */

import bcrypt from 'bcrypt';
import { prisma } from '@/lib/prisma';
import { sendMail } from '@/lib/mailer';
import {
  consumeSingleUseToken,
  issueSingleUseToken,
  revokeSingleUseTokens,
  PASSWORD_RESET_TTL_MS,
} from '@/lib/single-use-token';
import { invalidateSessionUser } from '@/lib/session-user-cache';

/** How the reset link is built. The app's public URL is set by the installer. */
function resetUrl(token: string): string {
  const base = (process.env.NEXTAUTH_URL ?? '').trim().replace(/\/+$/, '');
  return `${base}/reset-password?token=${encodeURIComponent(token)}`;
}

function minutes(ms: number): number {
  return Math.round(ms / 60_000);
}

/**
 * Handle a reset request for an address.
 *
 * Returns nothing: the caller must answer identically regardless, so there is deliberately no
 * result to branch on. Failures are swallowed and logged by the caller rather than surfaced,
 * for the same reason.
 */
export async function requestPasswordReset(email: string): Promise<{ sent: boolean }> {
  const user = await prisma.user.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: { id: true, email: true, firstName: true, inactive: true },
  });

  // No account, or a disabled one. A disabled account gets no mail at all: an administrator
  // turned it off, and a reset link would be a way back in.
  if (!user || user.inactive) return { sent: false };

  // Any earlier link stops working the moment a new one is asked for, so a forwarded or
  // intercepted older email cannot still be used.
  await revokeSingleUseTokens({ userId: user.id, purpose: 'PASSWORD_RESET' });

  const { token } = await issueSingleUseToken({
    purpose: 'PASSWORD_RESET',
    userId: user.id,
    ttlMs: PASSWORD_RESET_TTL_MS,
  });

  const greeting = user.firstName ? `Hello ${user.firstName},` : 'Hello,';
  await sendMail({
    to: user.email,
    subject: 'Reset your AFCT password',
    text:
      `${greeting}\n\n` +
      'Someone asked to reset the password for your AFCT account. To choose a new one, open:\n\n' +
      `${resetUrl(token)}\n\n` +
      `This link works once and expires in ${minutes(PASSWORD_RESET_TTL_MS)} minutes.\n\n` +
      'If you did not ask for this, you can ignore this message. Your password will not change ' +
      'and nobody has been given access to your account.\n',
  });

  return { sent: true };
}

export type ResetOutcome =
  | { ok: true; userId: string }
  /** Unknown, expired, already used: one outcome on purpose, so none can be told apart. */
  | { ok: false; reason: 'invalid' };

/**
 * Spend a reset token and set the new password.
 *
 * Everything happens in one transaction: the token is spent, the password is written, and any
 * other outstanding links are withdrawn together. A partial application here would either burn
 * a token without changing the password, or change it while leaving a second link live.
 */
export async function completePasswordReset(
  token: string,
  newPassword: string,
): Promise<ResetOutcome> {
  const hashed = await bcrypt.hash(newPassword, 10);

  const result = await prisma.$transaction(async (tx) => {
    const consumed = await consumeSingleUseToken({ token, purpose: 'PASSWORD_RESET', tx });
    if (!consumed?.userId) return null;

    // Confirms the account is still usable. A user disabled between asking for the link and
    // following it must not be able to walk back in through it.
    const user = await tx.user.findUnique({
      where: { id: consumed.userId },
      select: { id: true, inactive: true },
    });
    if (!user || user.inactive) return null;

    await tx.user.update({
      where: { id: user.id },
      data: {
        password: hashed,
        temporaryPassword: false,
        // The mechanism that ends existing sessions and refuses client tokens issued earlier:
        // both compare their own issue time against this.
        passwordChangedAt: new Date(),
        // Recovering an account is also the way out of a lockout, so clear it. Refusing here
        // would leave someone who has just proved control of their mailbox still shut out.
        lockedUntil: null,
      },
    });

    // A second link requested earlier must not still work after a successful reset.
    await revokeSingleUseTokens({ userId: user.id, purpose: 'PASSWORD_RESET', tx });

    return user.id;
  });

  if (!result) return { ok: false, reason: 'invalid' };

  // Outside the transaction: this is an in-memory cache, not a database write, and it must not
  // be rolled back with one.
  invalidateSessionUser(result);

  return { ok: true, userId: result };
}
