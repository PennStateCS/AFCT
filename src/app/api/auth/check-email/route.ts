import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { normalizeEmail } from '@/lib/email';
import { withAdminAuth } from '@/lib/api/with-auth';
import {
  evaluateCheckEmailRateLimit,
  getClientIp,
  formatRetryAfterSeconds,
} from '@/lib/security/rate-limiter';

/**
 * Reports whether an email is already registered.
 *
 * This was unauthenticated, on the reasoning that a signup form should warn before submitting
 * and that the leak was a fair price for it. The signup form never used it: the only caller is
 * the admin-only Change User Email dialog, which needs to know whether an address is taken
 * before it offers to save. So the trade was being paid for and not spent.
 *
 * It matters because of what sits next to it. `/api/auth/password-reset` answers identically
 * for every address and now queues its mail so it answers in the same *time* too, all to avoid
 * saying whether an account exists. An unauthenticated endpoint that answers that question
 * outright undoes the lot. Administrators may ask; nobody else needs to.
 *
 * The IP rate limit stays as defence in depth: an admin session is not a licence to enumerate
 * the directory at speed, and the limit is what an administrator sees on System Status.
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
 *   401: { description: Not signed in. }
 *   403: { description: Caller is not a system administrator. }
 *   429: { description: Too many checks from this IP; retry after the Retry-After header. }
 */
export const GET = withAdminAuth(async (request: Request) => {
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
}, { deniedAction: 'CHECK_EMAIL_DENIED' });
