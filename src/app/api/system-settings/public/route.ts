import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  DEFAULT_ALLOW_SIGNUP,
  DEFAULT_CLOCK_24_HOUR,
  DEFAULT_SESSION_TIMEOUT_MINUTES,
  DEFAULT_SYSTEM_TIMEZONE,
} from '@/lib/system-settings';
import { getHcaptchaSiteKey } from '@/lib/hcaptcha';

/**
 * The safe subset of system settings the login and signup screens need before a
 * user is authenticated. Deliberately public and limited to non-sensitive values
 * (notably the hCaptcha *site* key, never the secret).
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
  try {
    const settings = await prisma.systemSettings.findUnique({ where: { id: 1 } });
    return NextResponse.json({
      timezone: settings?.timezone ?? DEFAULT_SYSTEM_TIMEZONE,
      allowSignup: settings?.allowSignup ?? DEFAULT_ALLOW_SIGNUP,
      sessionTimeoutMinutes: settings?.sessionTimeoutMinutes ?? DEFAULT_SESSION_TIMEOUT_MINUTES,
      clock24Hour: settings?.clock24Hour ?? DEFAULT_CLOCK_24_HOUR,
      // Public site key only; the secret is never exposed.
      hcaptchaSiteKey: await getHcaptchaSiteKey(),
    });
  } catch (error) {
    // Unauthenticated endpoint loaded on every login/signup screen; a DB blip
    // must not escape as an unhandled framework 500.
    console.error('system-settings/public error:', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
