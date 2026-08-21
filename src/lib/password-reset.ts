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
import { queueMail } from '@/lib/mail-queue';
import { publicAppUrl } from '@/lib/public-app-url';
import {
  consumeSingleUseToken,
  issueSingleUseToken,
  revokeSingleUseTokens,
  PASSWORD_RESET_TTL_MS,
} from '@/lib/single-use-token';
import { invalidateSessionUser } from '@/lib/session-user-cache';
import { describeHowToSignIn, linkedAccountPasswordsAllowed } from '@/lib/account-credentials';

/**
 * How the reset link is built.
 *
 * From the configured public address and never from the request, which is the difference between
 * a link to AFCT and a link to wherever the sender of a forged `Host` header wanted the token to
 * go. Throws when that address is unusable rather than producing a relative URL nobody can open.
 */
function resetUrl(token: string): string {
  return publicAppUrl(`/reset-password?token=${encodeURIComponent(token)}`);
}

function minutes(ms: number): number {
  return Math.round(ms / 60_000);
}

/**
 * Handle a reset request for an address.
 *
 * The caller must answer identically regardless, so `sent` says only whether a message was
 * queued and is for the audit log, never for the response body.
 */
export async function requestPasswordReset(
  email: string,
): Promise<{ sent: boolean; kind?: 'reset' | 'explanation' }> {
  const user = await prisma.user.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: {
      id: true,
      email: true,
      firstName: true,
      inactive: true,
      password: true,
      linkedIdentities: { select: { kind: true } },
    },
  });

  // No account, or a disabled one. A disabled account gets no mail at all: an administrator
  // turned it off, and a reset link would be a way back in.
  if (!user || user.inactive) return { sent: false };

  /**
   * An account with no password has nothing to reset, and must not be given one this way.
   *
   * Sending a reset link here would quietly add a second way into an account at an institution
   * that chose its own sign-in precisely to avoid that: control of a mailbox would become
   * control of the account, bypassing whatever the institution requires at its own login.
   *
   * So this explains instead. It costs somebody who has genuinely lost their way in, which is
   * why every version of the message also names an administrator, and why the account page
   * offers to set a password to anybody who can still get in at all.
   */
  if (!user.password) {
    const greeting = user.firstName ? `Hello ${user.firstName},` : 'Hello,';
    const kinds = [...new Set(user.linkedIdentities.map((identity) => identity.kind))];
    const allowed = await linkedAccountPasswordsAllowed();

    await queueMail({
      to: user.email,
      subject: 'How to sign in to AFCT',
      text:
        `${greeting}\n\n` +
        'Someone asked to reset the AFCT password for this address. There is no password on ' +
        'this account, so there is nothing to reset, and no password has been changed.\n\n' +
        `${describeHowToSignIn(kinds).join('\n')}\n` +
        (allowed
          ? '\nOnce you are signed in, you can set an AFCT password on your Account page.\n'
          : '') +
        '\nIf you did not ask for this, you can ignore this message. Nothing about your ' +
        'account has changed.\n',
    });

    return { sent: true, kind: 'explanation' };
  }

  /**
   * Earlier links are deliberately left alone.
   *
   * This used to revoke them, on the reasoning that an intercepted older email should stop
   * working. The effect was the opposite of hardening: the endpoint is unauthenticated, so
   * anyone who knew an address could destroy that person's working recovery link by asking for
   * another one, over and over, and never need access to the mailbox. It was worse when the
   * replacement failed to send, which left somebody with a link that had been revoked and no
   * email to replace it.
   *
   * Several links may therefore be live at once, each for its own short life. That is a much
   * smaller exposure than it sounds: they all belong to the same mailbox, and the *first* one
   * used revokes the rest, which is the property that actually matters.
   */
  const issued = await prisma.$transaction(async (tx) => {
    const { token } = await issueSingleUseToken({
      purpose: 'PASSWORD_RESET',
      userId: user.id,
      ttlMs: PASSWORD_RESET_TTL_MS,
      tx,
    });

    const greeting = user.firstName ? `Hello ${user.firstName},` : 'Hello,';
    // Queued rather than sent. The caller must answer in the same time whether or not this
    // address has an account, and it cannot do that while holding an SMTP conversation open.
    // Written in the same transaction as the token, so neither can exist without the other.
    await queueMail({
      to: user.email,
      subject: 'Reset your AFCT password',
      text:
        `${greeting}\n\n` +
        'Someone asked to reset the password for your AFCT account. To choose a new one, open:\n\n' +
        `${resetUrl(token)}\n\n` +
        `This link works once and expires in ${minutes(PASSWORD_RESET_TTL_MS)} minutes.\n\n` +
        'If you did not ask for this, you can ignore this message. Your password will not change ' +
        'and nobody has been given access to your account.\n',
      token,
      tx,
    });

    return true;
  });

  return { sent: issued, kind: 'reset' };
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
