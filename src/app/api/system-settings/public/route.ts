import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  DEFAULT_ALLOW_SIGNUP,
  DEFAULT_SESSION_TIMEOUT_MINUTES,
  DEFAULT_SYSTEM_TIMEZONE,
} from '@/lib/system-settings';
import { getHcaptchaSiteKey } from '@/lib/hcaptcha';

/**
 * The safe subset of system settings the login and signup screens need before a
 * user is authenticated. Deliberately public and limited to non-sensitive values
 * — notably the hCaptcha *site* key, never the secret.
 * @openapi
 * summary: Get public system settings
 * responses:
 *   200:
 *     description: Public settings for unauthenticated screens.
 *     content:
 *       application/json:
 *         schema:
 *           type: object
 *           properties:
 *             timezone: { type: string }
 *             allowSignup: { type: boolean }
 *             sessionTimeoutMinutes: { type: integer }
 *             hcaptchaSiteKey: { type: string }
 */
export async function GET() {
  const settings = await prisma.systemSettings.findUnique({ where: { id: 1 } });
  return NextResponse.json({
    timezone: settings?.timezone ?? DEFAULT_SYSTEM_TIMEZONE,
    allowSignup: settings?.allowSignup ?? DEFAULT_ALLOW_SIGNUP,
    sessionTimeoutMinutes: settings?.sessionTimeoutMinutes ?? DEFAULT_SESSION_TIMEOUT_MINUTES,
    // Public site key only; the secret is never exposed.
    hcaptchaSiteKey: await getHcaptchaSiteKey(),
  });
}
