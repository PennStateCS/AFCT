import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { readJson } from '@/lib/api/request';
import { apiError } from '@/lib/api/http';
import { getClientIp, formatRetryAfterSeconds } from '@/lib/security/rate-limiter';
import { verifyCredentials } from '@/lib/credentials';
import { issueClientToken } from '@/lib/client-auth';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { logError } from '@/lib/api/activity';
import { ClientLoginSchema } from '@/schemas/client';

/**
 * Native-client login. Verifies email + password through the same shared path as
 * the browser login (rate limiting, account lockout, bot friction, bcrypt, security
 * logging) and, on success, issues a **bearer token** the client sends on every
 * later request as `Authorization: Bearer <token>`. Unlike the browser flow there's
 * no cookie, no CSRF, and no idle-timeout. The rate limiter's captcha "challenge"
 * (which a native client can't solve) is reported as a 429 back-off.
 * @openapi
 * summary: Client login (issue a bearer token)
 * requestBody:
 *   required: true
 *   content:
 *     application/json:
 *       schema:
 *         type: object
 *         required: [email, password]
 *         properties:
 *           email: { type: string }
 *           password: { type: string }
 *           deviceName: { type: string, description: Optional label to identify this token }
 * responses:
 *   200:
 *     description: A bearer token and the signed-in user.
 *     content:
 *       application/json:
 *         schema:
 *           type: object
 *           properties:
 *             token: { type: string }
 *             expiresAt: { type: string }
 *             user: { type: object }
 *   400: { description: Missing or malformed fields. }
 *   401: { description: Invalid email or password. }
 *   429: { description: Too many attempts; retry after the Retry-After header. }
 *   500: { description: Server error. }
 */
export async function POST(req: Request) {
  try {
    const parsed = await readJson(req, ClientLoginSchema);
    if (!parsed.ok) return parsed.response;
    const { email, password, deviceName } = parsed.data;

    const result = await verifyCredentials({ email, password, ipAddress: getClientIp(req) });

    if (!result.ok) {
      if (result.reason === 'rate_limited' || result.reason === 'challenge_required') {
        return NextResponse.json(
          { error: 'Too many attempts. Please try again later.' },
          { status: 429, headers: { 'Retry-After': formatRetryAfterSeconds(result.retryAfterMs) } },
        );
      }
      return apiError(401, 'Invalid email or password.');
    }

    const { token, expiresAt } = await issueClientToken(result.user.id, { label: deviceName });

    await createEnhancedActivityLog(prisma, req, {
      userId: result.user.id,
      action: 'CLIENT_LOGIN',
      severity: 'INFO',
      category: 'USER',
      metadata: { userId: result.user.id, label: deviceName ?? null },
    });

    return NextResponse.json({
      token,
      expiresAt: expiresAt.toISOString(),
      user: {
        id: result.user.id,
        email: result.user.email,
        firstName: result.user.firstName,
        lastName: result.user.lastName,
      },
    });
  } catch (error) {
    console.error('[CLIENT_LOGIN_ERROR]', error);
    await logError(req, { userId: null, action: 'CLIENT_LOGIN_ERROR', error, category: 'USER' });
    return apiError(500, 'Internal server error');
  }
}
