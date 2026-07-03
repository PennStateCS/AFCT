import { getHcaptchaSecretKey } from '@/lib/hcaptcha';

const HCAPTCHA_ENDPOINT = 'https://hcaptcha.com/siteverify';

export async function verifyCaptchaToken(token?: string | null, ip?: string | null) {
  const secret = await getHcaptchaSecretKey();

  if (!secret || !token) {
    return false;
  }

  try {
    const payload = new URLSearchParams({
      secret,
      response: token,
    });

    if (ip) {
      payload.append('remoteip', ip);
    }

    const res = await fetch(HCAPTCHA_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: payload,
    });

    if (!res.ok) {
      return false;
    }

    const data = (await res.json()) as { success?: boolean };
    return Boolean(data?.success);
  } catch (error) {
    console.error('[captcha] verification failed', error);
    return false;
  }
}
