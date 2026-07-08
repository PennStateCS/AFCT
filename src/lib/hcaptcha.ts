// Server-only resolver for hCaptcha keys. Source of truth is SystemSettings
// (editable in the admin UI); falls back to env vars, then treats captcha as
// unconfigured. The secret is never sent to the client.

import { prisma } from '@/lib/prisma';

const clean = (v: string | null | undefined): string | null => {
  const t = v?.trim();
  return t ? t : null;
};

export async function getHcaptchaSiteKey(): Promise<string | null> {
  try {
    const s = await prisma.systemSettings.findUnique({
      where: { id: 1 },
      select: { hcaptchaSiteKey: true },
    });
    return clean(s?.hcaptchaSiteKey) ?? clean(process.env.NEXT_PUBLIC_HCAPTCHA_SITE_KEY);
  } catch {
    return clean(process.env.NEXT_PUBLIC_HCAPTCHA_SITE_KEY);
  }
}

export async function getHcaptchaSecretKey(): Promise<string | null> {
  try {
    const s = await prisma.systemSettings.findUnique({
      where: { id: 1 },
      select: { hcaptchaSecretKey: true },
    });
    return clean(s?.hcaptchaSecretKey) ?? clean(process.env.HCAPTCHA_SECRET_KEY);
  } catch {
    return clean(process.env.HCAPTCHA_SECRET_KEY);
  }
}
