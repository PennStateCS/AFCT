import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcrypt';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import {
  evaluatePasswordChangeRateLimit,
  formatRetryAfterSeconds,
} from '@/lib/security/rate-limiter';
import { logError } from '@/lib/api/activity';
import { isStrongPassword, passwordRequirementText } from '@/lib/password-policy';
import { readJson } from '@/lib/api/request';
import { invalidateSessionUser } from '@/lib/session-user-cache';
import { linkedAccountPasswordsAllowed } from '@/lib/account-credentials';
import { queueMail } from '@/lib/mail-queue';
import { isMailConfigured } from '@/lib/mailer';
import { publicAppUrl } from '@/lib/public-app-url';

/**
 * `oldPassword` is optional in the shape, not in the rule.
 *
 * An account that has no password has no current one to supply, and demanding it made setting
 * a first password impossible for anybody who arrived through an institution or an LMS. Which
 * branch runs is decided from the database below and never from what arrived here, so omitting
 * the field is not a way to skip the check.
 */
const ChangePasswordBody = z.object({
  oldPassword: z.string().min(1).optional(),
  newPassword: z.string().min(1),
});

/**
 * Tell somebody their account now has an AFCT password.
 *
 * Queued rather than sent, like every other message, so a slow or broken mail server cannot
 * hold up the request. Silent when the site sends no mail at all, which is a supported way to
 * run AFCT rather than a fault.
 */
async function notifyPasswordWasSet(userId: string): Promise<void> {
  if (!(await isMailConfigured())) return;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, firstName: true },
  });
  if (!user) return;

  const greeting = user.firstName ? `Hello ${user.firstName},` : 'Hello,';
  await queueMail({
    to: user.email,
    subject: 'An AFCT password was set for your account',
    text:
      `${greeting}\n\n` +
      'An AFCT password has just been set for your account. You can still sign in the way you ' +
      'did before; this only adds another way.\n\n' +
      `If this was you, there is nothing to do. If it was not, change your password at ` +
      `${publicAppUrl('/dashboard/account')} and tell an administrator, because somebody else ` +
      'may have been signed in as you.\n',
  });
}

/**
 * Lets a signed-in user set or change their own password.
 *
 * Two modes, chosen from the account rather than from the request. An account that has a
 * password is changing it and must supply the current one. An account that has none, which is
 * one created by an institutional sign-in or an LMS launch, is setting a first password, and
 * the session is the only proof available.
 * @openapi
 * summary: Set or change my password
 * description: >-
 *   Which mode runs is decided from the account, never from the body. With a password already
 *   set, `oldPassword` is required and verified, the new one must differ, and every session and
 *   app token issued beforehand is revoked. With no password set, `oldPassword` is not required
 *   and nothing is revoked, because no credential changed; this mode is refused when the site
 *   does not allow AFCT passwords on accounts that sign in through an institution or an LMS.
 * requestBody:
 *   required: true
 *   content:
 *     application/json:
 *       schema:
 *         type: object
 *         required: [newPassword]
 *         properties:
 *           oldPassword: { type: string, description: "The current password. Required unless the account has none." }
 *           newPassword: { type: string, description: Must meet the strength policy and differ from the old one }
 * responses:
 *   200:
 *     description: Password set or updated.
 *     content:
 *       application/json:
 *         schema:
 *           type: object
 *           properties:
 *             success: { type: boolean }
 *             message: { type: string }
 *   400: { description: "Weak password, missing current password, wrong current password, or reused password." }
 *   401: { description: Not signed in. }
 *   403: { description: This site does not allow AFCT passwords on accounts that sign in elsewhere. }
 *   404: { description: User record not found. }
 *   409: { description: A password was set by somebody else while this request was in flight. }
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

    if (!user) {
      console.error('[CHANGE_PASSWORD] User not found in database');
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    /**
     * No password to change: an account vouched for by an identity provider or an LMS launch
     * rather than one that chose a password here. Setting a first one is a different act from
     * changing an existing one, and this is where it happens.
     *
     * The session is the authority. Nothing else can be: there is no current password to prove
     * and, on an install with no mail server, no reset link either. That is the same reasoning
     * every product uses when an account created through a federated provider later wants a
     * password of its own.
     */
    if (!user.password) {
      if (!(await linkedAccountPasswordsAllowed())) {
        // Deliberately does not mention a reset link. On an install with no mail server there
        // is not one, and sending somebody to a page that is not there is worse than saying
        // plainly who can help.
        await createEnhancedActivityLog(prisma, req, {
          userId,
          action: 'SET_PASSWORD_DENIED',
          severity: 'SECURITY',
          category: 'USER',
          metadata: { reason: 'linked-account passwords are switched off' },
        });
        return NextResponse.json(
          {
            error:
              'This site does not let accounts that sign in through an institution or an LMS set an AFCT password. An administrator can give you one if you need it.',
          },
          { status: 403 },
        );
      }

      /**
       * Conditional on the password still being absent, rather than read-then-write.
       *
       * An administrator issuing a temporary password while this request is in flight would
       * otherwise have their write silently overwritten, and the forced change cleared with
       * it. The database decides which of the two happened; `count === 0` means one arrived
       * first, and the honest answer is the one the change branch would have given.
       */
      const { count } = await prisma.user.updateMany({
        where: { id: userId, password: null },
        data: {
          password: await bcrypt.hash(newPassword, 10),
          // Explicit rather than inherited, mirroring the change branch below: this password
          // was chosen by its owner, so nothing is forcing them to change it again.
          temporaryPassword: false,
          /**
           * `passwordChangedAt` is deliberately NOT stamped.
           *
           * It means "revoke everything issued before the credential changed", and nothing
           * changed here: there was no password. Stamping it would sign this person out of the
           * session they are using (`lib/session-password`) and reject any app token they had
           * already created (`lib/client-auth`), which is exactly the order a student setting
           * up the desktop client works in.
           */
        },
      });

      if (count === 0) {
        return NextResponse.json(
          { error: 'This account now has a password. Reload the page and change it instead.' },
          { status: 409 },
        );
      }

      invalidateSessionUser(userId);

      /**
       * Its own action, at SECURITY, rather than folded into `CHANGE_PASSWORD`.
       *
       * An account gaining a second way in is the thing somebody reviewing this log later is
       * looking for, and it must be possible to tell apart from an ordinary password change.
       */
      await createEnhancedActivityLog(prisma, req, {
        userId,
        action: 'SET_PASSWORD',
        severity: 'SECURITY',
        category: 'USER',
        metadata: { hadPassword: false },
      });

      // Tell the owner, if this site can. Adding a first credential to an account somebody
      // else vouches for is the step that turns a borrowed session into lasting access, and a
      // message they see is the only warning that does not depend on an administrator reading
      // the audit log. Never allowed to fail the request: the password is already set.
      await notifyPasswordWasSet(userId).catch((err) =>
        console.error('[SET_PASSWORD] could not queue the notification', err),
      );

      return NextResponse.json({ success: true, message: 'Password set successfully' });
    }

    // From here on this is a change, which needs the current password.
    if (!oldPassword) {
      return NextResponse.json({ error: 'Your current password is required' }, { status: 400 });
    }

    // Right before the compare, so only real guesses at the current password are charged:
    // the login lockout guards signing in, and whoever holds a stolen session is already
    // past it, with this form as their oracle for the one credential the session lacks.
    const limit = evaluatePasswordChangeRateLimit({ identifier: userId });
    if (limit.status === 'blocked') {
      await createEnhancedActivityLog(prisma, req, {
        userId,
        action: 'CHANGE_PASSWORD_RATE_LIMIT',
        severity: 'SECURITY',
        category: 'USER',
        metadata: { reason: 'too many current-password attempts' },
      });
      return NextResponse.json(
        { error: 'Too many attempts. Wait a few minutes and try again.' },
        { status: 429, headers: { 'Retry-After': formatRetryAfterSeconds(limit.retryAfterMs) } },
      );
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
      data: { password: hashedPassword, temporaryPassword: false, passwordChangedAt: new Date() },
    });
    // Revoke sibling sessions right away rather than at TTL.
    invalidateSessionUser(userId);

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
      category: 'USER',
      error: err,
    });
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
