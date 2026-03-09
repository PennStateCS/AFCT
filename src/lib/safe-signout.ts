'use client';

import { getCsrfToken } from 'next-auth/react';

type SafeSignOutOptions = {
  callbackUrl?: string;
};

export async function safeSignOut({ callbackUrl = '/login' }: SafeSignOutOptions = {}) {
  try {
    const csrfToken = await getCsrfToken();

    if (!csrfToken) {
      window.location.assign(callbackUrl);
      return;
    }

    const body = new URLSearchParams({
      csrfToken,
      callbackUrl,
      json: 'true',
    });

    const response = await fetch('/api/auth/signout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Auth-Return-Redirect': '1',
      },
      credentials: 'same-origin',
      body: body.toString(),
    });

    const data = (await response.json().catch(() => null)) as { url?: string } | null;
    window.location.assign(data?.url ?? callbackUrl);
  } catch (error) {
    console.error('[auth] Unable to complete Auth.js signout; redirecting to callback URL.', error);
    window.location.assign(callbackUrl);
  }
}