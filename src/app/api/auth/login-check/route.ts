import { NextResponse } from 'next/server';
import { getClientIp, peekLoginRateLimit } from '@/lib/security/rate-limiter';
import { getLoginLockoutPolicy } from '@/lib/login-policy';

/**
 * Read-only login rate-limit status. The login form calls this after a failed
 * `signIn` to classify the failure, because NextAuth (Auth.js v5) reports any
 * `authorize` error only as a generic `CredentialsSignin` — so the client can't
 * otherwise tell a captcha challenge or a temporary block apart from bad credentials.
 * This does NOT count an attempt (the credentials `authorize` path is the single
 * source of truth); it only reports the flags that path already set. Public.
 * @openapi
 * summary: Peek login rate-limit status
 * requestBody:
 *   required: false
 *   content:
 *     application/json:
 *       schema:
 *         type: object
 *         properties:
 *           email: { type: string, description: The account being signed into (for the per-account bucket) }
 * responses:
 *   200:
 *     description: The current rate-limit status for this IP + account.
 *     content:
 *       application/json:
 *         schema:
 *           type: object
 *           properties:
 *             status: { type: string, enum: [ok, challenge, blocked] }
 *             retryAfterMs: { type: integer, description: Milliseconds until the challenge/block clears (0 when ok) }
 */
export async function POST(req: Request) {
  const ip = getClientIp(req);
  let email: unknown;
  try {
    ({ email } = (await req.json()) as { email?: unknown });
  } catch {
    email = undefined;
  }
  const identifier = typeof email === 'string' ? email.trim().toLowerCase() : undefined;

  const accountLimit = await getLoginLockoutPolicy();
  const decision = peekLoginRateLimit({ ip, identifier, accountLimit });

  return NextResponse.json({
    status: decision.status,
    retryAfterMs: decision.status === 'ok' ? 0 : decision.retryAfterMs,
  });
}
