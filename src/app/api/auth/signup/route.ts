// /src/app/api/auth/signup

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcrypt';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import {
  applyBotFriction,
  evaluateSignupRateLimit,
  formatRetryAfterSeconds,
  getClientIp,
  recordSignupSuccess,
} from '@/lib/security/rate-limiter';
import { verifyCaptchaToken } from '@/lib/security/captcha';

// Regex utilities for validating email and password
const isValidEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const isStrongPassword = (pw: string) =>
  pw.length >= 8 &&
  /[A-Z]/.test(pw) &&
  /[a-z]/.test(pw) &&
  /\d/.test(pw) &&
  /[^A-Za-z0-9]/.test(pw); // Must contain a special character

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

    // Check for required fields
    if (!normalizedEmail || !password || !firstName || !lastName) {
      return NextResponse.json({ error: 'Missing required fields.' }, { status: 400 });
    }

    // Validate email format
    if (!isValidEmail(normalizedEmail)) {
      return NextResponse.json({ error: 'Invalid email format.' }, { status: 400 });
    }

    // Validate password strength
    if (!isStrongPassword(password)) {
      return NextResponse.json(
        {
          error:
            'Password must be at least 8 characters and include uppercase, lowercase, number, and special character.',
        },
        { status: 400 },
      );
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

    // Check for existing user
    const existingUser = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (existingUser) {
      return NextResponse.json({ error: 'Email already registered.' }, { status: 409 });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create new user in the database
    const newUser = await prisma.user.create({
      data: {
        email: normalizedEmail,
        firstName,
        lastName,
        password: hashedPassword,
        role,
      },
    });

    // Log the signup event in ActivityLog
    await createEnhancedActivityLog(prisma, req, {
      userId: newUser.id,
      action: 'USER_SIGNUP',
      category: 'USER',
      metadata: {
        userId: newUser.id,
        email: normalizedEmail,
        role: role,
      },
    });

    recordSignupSuccess({ ip: ipAddress, identifier: normalizedEmail });

    // Return success response
    return NextResponse.json({ message: 'User created', userId: newUser.id }, { status: 201 });
  } catch (err) {
    console.error('[SIGNUP_ERROR]', err);
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
        metadata,
      },
    });
  } catch (error) {
    console.error('[signup] security log failure', error);
  }
}
