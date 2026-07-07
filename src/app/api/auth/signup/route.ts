import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcrypt';
import { createEnhancedActivityLog, inferSeverity } from '@/lib/activity-log-utils';
import {
  applyBotFriction,
  evaluateSignupRateLimit,
  formatRetryAfterSeconds,
  getClientIp,
  recordSignupSuccess,
} from '@/lib/security/rate-limiter';
import { verifyCaptchaToken } from '@/lib/security/captcha';
import { isStrongPassword, passwordRequirementText } from '@/lib/password-policy';

const isValidEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

/**
 * Self-service account registration. Gated by the `allowSignup` system setting,
 * and protected by a tiered rate limiter: repeated attempts escalate from silent
 * friction, to a captcha challenge (428), to an outright block (429). The
 * password must satisfy the app's strength policy.
 * @openapi
 * summary: Register a new account
 * requestBody:
 *   required: true
 *   content:
 *     application/json:
 *       schema:
 *         type: object
 *         required: [firstName, lastName, email, password]
 *         properties:
 *           firstName: { type: string }
 *           lastName: { type: string }
 *           email: { type: string }
 *           password: { type: string, description: Must meet the strength policy }
 *           role: { type: string, description: Accepted from the client; defaults to STUDENT }
 *           interactionMs: { type: integer, description: Time spent on the form; feeds bot-friction heuristics }
 *           captchaToken: { type: string, description: Required only when the rate limiter issues a challenge }
 * responses:
 *   201:
 *     description: Account created.
 *     content:
 *       application/json:
 *         schema:
 *           type: object
 *           properties:
 *             message: { type: string }
 *             userId: { type: string }
 *   400: { description: Missing fields, invalid email, or weak password. }
 *   403: { description: Signup is disabled. }
 *   409: { description: Email already registered. }
 *   428: { description: Rate limiter requires a captcha challenge; retry with captchaToken. }
 *   429: { description: Too many attempts; retry after the Retry-After header. }
 *   500: { description: Server error. }
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      firstName,
      lastName,
      email,
      password,
      role = 'STUDENT',
      interactionMs,
      captchaToken,
    } = body;
    const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : email;
    const ipAddress = getClientIp(req);

    const settings = await prisma.systemSettings.findUnique({
      where: { id: 1 },
      select: { allowSignup: true },
    });
    if (settings?.allowSignup === false) {
      return NextResponse.json({ error: 'Signup is disabled.' }, { status: 403 });
    }

    if (!normalizedEmail || !password || !firstName || !lastName) {
      return NextResponse.json({ error: 'Missing required fields.' }, { status: 400 });
    }
    if (!isValidEmail(normalizedEmail)) {
      return NextResponse.json({ error: 'Invalid email format.' }, { status: 400 });
    }
    if (!isStrongPassword(password)) {
      return NextResponse.json({ error: passwordRequirementText }, { status: 400 });
    }

    const rateDecision = evaluateSignupRateLimit({
      ip: ipAddress,
      identifier: normalizedEmail,
      interactionMs: Number.isFinite(Number(interactionMs)) ? Number(interactionMs) : undefined,
    });

    if (rateDecision.status === 'blocked') {
      await logSecurityEvent('SIGNUP_RATE_LIMIT', {
        ip: ipAddress,
        identifier: normalizedEmail,
      });
      return NextResponse.json(
        { error: 'Too many signup attempts. Please try again later.' },
        {
          status: 429,
          headers: { 'Retry-After': formatRetryAfterSeconds(rateDecision.retryAfterMs) },
        },
      );
    }

    if (rateDecision.status === 'challenge') {
      const captchaValid = await verifyCaptchaToken(captchaToken, ipAddress);
      if (!captchaValid) {
        await logSecurityEvent('SIGNUP_CHALLENGE_REQUIRED', {
          ip: ipAddress,
          identifier: normalizedEmail,
        });
        return NextResponse.json(
          { error: 'Please slow down. Wait a moment before creating another account.' },
          {
            status: 428,
            headers: { 'Retry-After': formatRetryAfterSeconds(rateDecision.retryAfterMs) },
          },
        );
      }

      await logSecurityEvent('SIGNUP_CHALLENGE_SOLVED', {
        ip: ipAddress,
        identifier: normalizedEmail,
      });
    }

    if (rateDecision.status === 'ok' && rateDecision.applyFriction) {
      await applyBotFriction(rateDecision.frictionDelayMs);
    }

    const existingUser = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });
    if (existingUser) {
      return NextResponse.json({ error: 'Email already registered.' }, { status: 409 });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    // NOTE: `role` is taken from the request body (defaulting to STUDENT). There
    // is no server-side check that the caller may claim an elevated role.
    const newUser = await prisma.user.create({
      data: {
        email: normalizedEmail,
        firstName,
        lastName,
        password: hashedPassword,
        role,
      },
    });

    await createEnhancedActivityLog(prisma, req, {
      userId: newUser.id,
      action: 'USER_SIGNUP',
      severity: 'INFO',
      category: 'USER',
      metadata: {
        userId: newUser.id,
        email: normalizedEmail,
        role: role,
      },
    });

    recordSignupSuccess({ ip: ipAddress, identifier: normalizedEmail });

    return NextResponse.json({ message: 'User created', userId: newUser.id }, { status: 201 });
  } catch (err) {
    console.error('[SIGNUP_ERROR]', err);
    await createEnhancedActivityLog(prisma, req, {
      userId: null,
      action: 'SIGNUP_ERROR',
      severity: 'ERROR',
      category: 'USER',
      metadata: { error: err instanceof Error ? err.message : 'unknown error' },
    });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

type SignupSecurityEventAction =
  | 'SIGNUP_RATE_LIMIT'
  | 'SIGNUP_CHALLENGE_REQUIRED'
  | 'SIGNUP_CHALLENGE_SOLVED';

async function logSecurityEvent(
  action: SignupSecurityEventAction,
  metadata: { ip?: string | null; identifier?: string | null },
) {
  try {
    await prisma.activityLog.create({
      data: {
        action,
        category: 'SECURITY',
        severity: inferSeverity(action),
        // Promote the known client IP into the column (not just metadata).
        ipAddress: metadata.ip ?? null,
        metadata,
      },
    });
  } catch (error) {
    console.error('[signup] security log failure', error);
  }
}
