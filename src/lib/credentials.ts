// src/lib/credentials.ts
//
// Shared email+password verification for both the browser login (the NextAuth
// credentials `authorize`) and the native-client login endpoint. Keeping it in one
// place means both paths apply the same rate limiting, account lockout, bot
// friction, captcha challenge, bcrypt check, and security logging, so they can't
// drift apart.
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcrypt';
import { createEnhancedActivityLog, type LogSeverity } from '@/lib/activity-log-utils';
import {
  applyBotFriction,
  evaluateLoginRateLimit,
  recordLoginSuccess,
} from '@/lib/security/rate-limiter';
import { verifyCaptchaToken } from '@/lib/security/captcha';
import { getLoginLockoutPolicy } from '@/lib/login-policy';

type LoginSecurityEventAction =
  | 'LOGIN_RATE_LIMIT'
  | 'LOGIN_CHALLENGE_REQUIRED'
  | 'LOGIN_CHALLENGE_SOLVED'
  | 'LOGIN_FAILED';

/** Append an audit-log entry for a login event (best-effort). */
async function logLoginSecurityEvent(
  action: LoginSecurityEventAction,
  metadata: { ip?: string; identifier?: string; reason?: string },
  userId?: string | null,
): Promise<void> {
  // Explicit severity: every login security event is a SECURITY signal except a
  // solved challenge, which is routine INFO.
  const severity: LogSeverity = action === 'LOGIN_CHALLENGE_SOLVED' ? 'INFO' : 'SECURITY';
  try {
    await createEnhancedActivityLog(
      prisma,
      { ipAddress: metadata.ip ?? null },
      { userId: userId ?? null, action, category: 'SYSTEM', severity, metadata },
    );
  } catch (error) {
    console.error('[auth] security log failure', error);
  }
}

/** The user fields both callers need after a successful verification. */
export type VerifiedUser = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  isAdmin: boolean;
  avatar: string | null;
  mustChangePassword: boolean;
};

export type VerifyCredentialsResult =
  | { ok: true; user: VerifiedUser }
  | { ok: false; reason: 'invalid' }
  | { ok: false; reason: 'rate_limited'; retryAfterMs: number }
  | { ok: false; reason: 'challenge_required'; retryAfterMs: number };

/**
 * Persist an auto-expiring lock onto the user row when the in-memory account limiter
 * blocks them. Best-effort and non-blocking: a login attempt must not fail because this
 * write failed, and the in-memory limiter is already rejecting them regardless.
 *
 * The `where` only matches a user who is not already locked into the future, so exactly
 * the transition into a lock writes; every subsequent blocked attempt updates zero rows.
 * Email is unique, so this touches at most one row and does nothing for an unknown
 * address (no account-existence signal).
 */
async function persistAccountLock(email: string, retryAfterMs: number): Promise<void> {
  if (!Number.isFinite(retryAfterMs) || retryAfterMs <= 0) return;
  const lockedUntil = new Date(Date.now() + retryAfterMs);
  try {
    await prisma.user.updateMany({
      where: {
        email,
        OR: [{ lockedUntil: null }, { lockedUntil: { lte: new Date() } }],
      },
      data: { lockedUntil },
    });
  } catch (error) {
    console.error('[credentials] failed to persist account lock:', error);
  }
}

/**
 * Verify an email + password. Returns a discriminated result rather than throwing,
 * so each caller can map it to its own transport (NextAuth throws sentinel errors;
 * the client endpoint returns 401/429/428). Security logging happens here, once.
 */
export async function verifyCredentials(params: {
  email: string | undefined;
  password: string | undefined;
  ipAddress: string;
  interactionMs?: number;
  captchaToken?: string;
}): Promise<VerifyCredentialsResult> {
  const { password, ipAddress, interactionMs, captchaToken } = params;
  const emailInput = params.email?.trim().toLowerCase();

  if (!emailInput || !password) {
    void logLoginSecurityEvent('LOGIN_FAILED', {
      ip: ipAddress,
      identifier: emailInput,
      reason: 'missing credentials',
    });
    return { ok: false, reason: 'invalid' };
  }

  const accountLimit = await getLoginLockoutPolicy();
  const rateDecision = evaluateLoginRateLimit({
    ip: ipAddress,
    identifier: emailInput,
    interactionMs: Number.isFinite(interactionMs) ? interactionMs : undefined,
    accountLimit,
  });

  if (rateDecision.status === 'blocked') {
    void logLoginSecurityEvent('LOGIN_RATE_LIMIT', { ip: ipAddress, identifier: emailInput });
    // The in-memory bucket just blocked this account. Persist the lock to the user row
    // so it survives a restart and is visible to every instance and to the admin UI.
    // Guarded so only the transition into a lock writes: once lockedUntil is in the
    // future, this matches zero rows and does nothing (and the read gate below
    // short-circuits future attempts before they even reach here).
    void persistAccountLock(emailInput, rateDecision.retryAfterMs);
    return { ok: false, reason: 'rate_limited', retryAfterMs: rateDecision.retryAfterMs };
  }

  if (rateDecision.status === 'challenge') {
    const captchaValid = await verifyCaptchaToken(captchaToken, ipAddress);
    if (!captchaValid) {
      void logLoginSecurityEvent('LOGIN_CHALLENGE_REQUIRED', {
        ip: ipAddress,
        identifier: emailInput,
      });
      return { ok: false, reason: 'challenge_required', retryAfterMs: rateDecision.retryAfterMs };
    }
    void logLoginSecurityEvent('LOGIN_CHALLENGE_SOLVED', { ip: ipAddress, identifier: emailInput });
  }

  if (rateDecision.status === 'ok' && rateDecision.applyFriction) {
    await applyBotFriction(rateDecision.frictionDelayMs);
  }

  const user = await prisma.user.findFirst({
    where: { email: emailInput, inactive: false },
    // Only what the check + returned identity need; keep the hash scoped here.
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      isAdmin: true,
      avatar: true,
      temporaryPassword: true,
      lockedUntil: true,
      password: true,
    },
  });

  if (!user) {
    void logLoginSecurityEvent('LOGIN_FAILED', {
      ip: ipAddress,
      identifier: emailInput,
      reason: 'unknown or inactive account',
    });
    return { ok: false, reason: 'invalid' };
  }

  // Durable lock check, before the password compare: an account locked out by earlier
  // failed attempts stays locked until the instant passes, even across a restart. Same
  // `rate_limited` reason as the in-memory limiter, so a locked account and a
  // rate-limited one are indistinguishable to the caller.
  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    const retryAfterMs = user.lockedUntil.getTime() - Date.now();
    void logLoginSecurityEvent(
      'LOGIN_RATE_LIMIT',
      { ip: ipAddress, identifier: emailInput, reason: 'account locked' },
      user.id,
    );
    return { ok: false, reason: 'rate_limited', retryAfterMs };
  }

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) {
    void logLoginSecurityEvent(
      'LOGIN_FAILED',
      { ip: ipAddress, identifier: emailInput, reason: 'invalid password' },
      user.id,
    );
    return { ok: false, reason: 'invalid' };
  }

  recordLoginSuccess({ ip: ipAddress, identifier: emailInput });
  return {
    ok: true,
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      isAdmin: user.isAdmin,
      avatar: user.avatar,
      mustChangePassword: user.temporaryPassword,
    },
  };
}
