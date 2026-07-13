// src/lib/credentials.ts
//
// Shared email+password verification for both the browser login (the NextAuth
// credentials `authorize`) and the native-client login endpoint. Keeping it in one
// place means both paths apply the same rate limiting, account lockout, bot
// friction, captcha challenge, bcrypt check, and security logging — they can't
// drift apart.
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcrypt';
import { inferSeverity } from '@/lib/activity-log-utils';
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

/** Append a SECURITY audit-log entry for a login event (best-effort). */
async function logLoginSecurityEvent(
  action: LoginSecurityEventAction,
  metadata: { ip?: string; identifier?: string; reason?: string },
  userId?: string | null,
): Promise<void> {
  try {
    await prisma.activityLog.create({
      data: {
        userId: userId ?? null,
        action,
        severity: inferSeverity(action),
        ipAddress: metadata.ip ?? null,
        metadata,
      },
    });
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
    // Only what the check + returned identity need — keep the hash scoped here.
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      isAdmin: true,
      avatar: true,
      temporaryPassword: true,
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
