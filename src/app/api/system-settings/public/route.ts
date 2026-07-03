import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  DEFAULT_ALLOW_SIGNUP,
  DEFAULT_SESSION_TIMEOUT_MINUTES,
  DEFAULT_SYSTEM_TIMEZONE,
} from '@/lib/system-settings';
import { getHcaptchaSiteKey } from '@/lib/hcaptcha';

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
