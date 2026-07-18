import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withAdminAuth } from '@/lib/api/with-auth';
import { readJson } from '@/lib/api/request';
import { verifyCaptchaToken } from '@/lib/security/captcha';
import { getClientIp } from '@/lib/security/rate-limiter';

const CaptchaTestSchema = z.object({ token: z.string().min(1) });

/**
 * Verifies an hCaptcha token against the configured secret key, so an admin can
 * confirm their hCaptcha keys actually work before turning captcha loose on real
 * logins. Returns `{ ok }`. Admin only; never returns the secret.
 * @openapi
 * summary: Test the configured hCaptcha keys
 * requestBody:
 *   required: true
 *   content:
 *     application/json:
 *       schema:
 *         type: object
 *         required: [token]
 *         properties:
 *           token: { type: string, description: The hCaptcha response token from a solved widget }
 * responses:
 *   200:
 *     description: Whether the token verified against the stored secret.
 *     content:
 *       application/json:
 *         schema:
 *           type: object
 *           properties:
 *             ok: { type: boolean }
 *   400: { description: Missing or invalid token. }
 *   403: { description: Caller is not a system administrator. }
 */
export const POST = withAdminAuth(
  async (req) => {
    const parsed = await readJson(req, CaptchaTestSchema);
    if (!parsed.ok) return parsed.response;
    const ok = await verifyCaptchaToken(parsed.data.token, getClientIp(req));
    return NextResponse.json({ ok });
  },
  { deniedAction: 'CAPTCHA_TEST_DENIED' },
);
