import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { normalizeEmail } from '@/lib/email';
import {
  evaluateCheckEmailRateLimit,
  getClientIp,
  formatRetryAfterSeconds,
} from '@/lib/security/rate-limiter';

/**
 * Reports whether an email is already registered, so the signup form can warn
 * before submitting. Unauthenticated by design; it therefore leaks account
 * existence, which is an accepted trade-off for signup UX, but it is IP rate-limited
 * so it can't be used to bulk-enumerate accounts, and it only ever returns a boolean.
 * @openapi
 * summary: Check whether an email is registered
 * parameters:
 *   - { name: email, in: query, required: true, schema: { type: string } }
 * responses:
 *   200:
 *     description: Whether a user with that email exists.
 *     content:
 *       application/json:
 *         schema:
 *           type: object
 *           properties:
 *             exists: { type: boolean }
 *   400: { description: The email query parameter is missing. }
 *   429: { description: Too many checks from this IP; retry after the Retry-After header. }
 */
export async function GET(request: Request) {
  // Rate-limit by IP before touching the DB; caps bulk account enumeration.
  const decision = evaluateCheckEmailRateLimit({ ip: getClientIp(request) });
  if (decision.status === 'blocked') {
    return NextResponse.json(
      { error: 'Too many requests. Please try again later.' },
      { status: 429, headers: { 'Retry-After': formatRetryAfterSeconds(decision.retryAfterMs) } },
    );
  }

  const { searchParams } = new URL(request.url);
  const email = normalizeEmail(searchParams.get('email')) || null;

  if (!email) {
    return NextResponse.json({ error: 'Email is required.' }, { status: 400 });
  }

  try {
    // Existence check only; never select anything sensitive here.
    const existingUser = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });

    return NextResponse.json({ exists: !!existingUser });
  } catch (error) {
    // Unauthenticated endpoint hit on every signup screen; a DB blip must not
    // escape as an unhandled framework 500.
    console.error('check-email error:', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
