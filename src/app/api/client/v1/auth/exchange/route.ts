import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { readJson } from '@/lib/api/request';
import { apiError } from '@/lib/api/http';
import {
  getClientIp,
  formatRetryAfterSeconds,
  evaluateClientExchangeRateLimit,
} from '@/lib/security/rate-limiter';
import { issueClientToken } from '@/lib/client-auth';
import { exchangeClientAuthCode } from '@/lib/client-auth-codes';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { logError } from '@/lib/api/activity';
import { ClientExchangeSchema } from '@/schemas/client';

/**
 * Redeems a browser sign-in authorization code (issued by the `/client-auth`
 * consent page) for a bearer token, completing RFC 8252's loopback flow. The
 * refusal body is the same for every failure: which check failed is written to the
 * activity log, where it is useful, and kept from an unauthenticated caller, where
 * it is a probe result.
 * @openapi
 * summary: Exchange a browser sign-in code for a bearer token
 * requestBody:
 *   required: true
 *   content:
 *     application/json:
 *       schema:
 *         type: object
 *         required: [code, codeVerifier, redirectUri]
 *         properties:
 *           code: { type: string, description: The authorization code from the consent redirect }
 *           codeVerifier: { type: string, description: The PKCE verifier for the challenge the code was issued against }
 *           redirectUri: { type: string, description: The exact loopback redirect URI the code was issued for }
 * responses:
 *   200:
 *     description: A bearer token and the signed-in user, as from /auth/login.
 *     content:
 *       application/json:
 *         schema:
 *           type: object
 *           properties:
 *             token: { type: string }
 *             expiresAt: { type: string }
 *             user: { type: object }
 *   400: { description: Missing or malformed fields. }
 *   401: { description: The code was not accepted. }
 *   429: { description: Too many attempts; retry after the Retry-After header. }
 *   500: { description: Server error. }
 */
export async function POST(req: Request) {
  try {
    const decision = evaluateClientExchangeRateLimit({ ip: getClientIp(req) });
    if (decision.status === 'blocked' || decision.status === 'challenge') {
      return NextResponse.json(
        { error: 'Too many attempts. Please try again later.' },
        { status: 429, headers: { 'Retry-After': formatRetryAfterSeconds(decision.retryAfterMs) } },
      );
    }

    const parsed = await readJson(req, ClientExchangeSchema);
    if (!parsed.ok) return parsed.response;
    const { code, codeVerifier, redirectUri } = parsed.data;

    const result = await exchangeClientAuthCode({ code, codeVerifier, redirectUri });

    if (!result.ok) {
      // WARN rather than INFO: an expired code is a slow student, but a replay or a
      // mismatched verifier/redirect is exactly the tampering this flow guards against.
      await createEnhancedActivityLog(prisma, req, {
        userId: null,
        action: 'CLIENT_AUTH_EXCHANGE_FAILED',
        severity: result.reason === 'expired' ? 'INFO' : 'WARNING',
        category: 'USER',
        metadata: { reason: result.reason },
      });
      return apiError(401, 'The sign-in could not be completed. Please sign in again.');
    }

    const { token, expiresAt } = await issueClientToken(result.userId, {
      label: result.deviceName,
    });

    // provider distinguishes this from a password login: under RQ5 "how did the
    // student authenticate" is a study variable, not presentation detail.
    await createEnhancedActivityLog(prisma, req, {
      userId: result.userId,
      action: 'CLIENT_LOGIN',
      severity: 'INFO',
      category: 'USER',
      metadata: {
        userId: result.userId,
        label: result.deviceName ?? null,
        provider: 'browser-approval',
      },
    });

    const user = await prisma.user.findUnique({
      where: { id: result.userId },
      select: { id: true, email: true, firstName: true, lastName: true },
    });

    return NextResponse.json({
      token,
      expiresAt: expiresAt.toISOString(),
      user,
    });
  } catch (error) {
    console.error('[CLIENT_AUTH_EXCHANGE_ERROR]', error);
    await logError(req, {
      userId: null,
      action: 'CLIENT_AUTH_EXCHANGE_ERROR',
      error,
      category: 'USER',
    });
    return apiError(500, 'Internal server error');
  }
}
