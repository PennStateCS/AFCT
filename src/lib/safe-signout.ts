'use client';

import { getCsrfToken, signOut } from 'next-auth/react';
import { safeCallbackUrl } from '@/lib/safe-callback';

type SafeSignOutOptions = {
  callbackUrl?: string;
};

/**
 * Signs the user out and redirects. The preferred path posts to the Auth.js signout
 * endpoint with a CSRF token (it returns a JSON `url` we can follow directly). If that
 * can't run — no CSRF token, or the request throws — we fall back to next-auth's
 * `signOut()`, which fetches its own CSRF token and reliably clears the session cookie.
 * The bare redirect is a last resort only when even that fails, so a hiccup can never
 * leave the user redirected-but-still-logged-in.
 */
export async function safeSignOut({ callbackUrl = '/login' }: SafeSignOutOptions = {}) {
  // Only ever redirect to a same-origin path (no open redirect); default to /login.
  const target = safeCallbackUrl(callbackUrl, '/login');

  try {
    const csrfToken = await getCsrfToken();
    if (csrfToken) {
      const body = new URLSearchParams({ csrfToken, callbackUrl: target, json: 'true' });
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
      window.location.assign(data?.url ?? target);
      return;
    }
  } catch (error) {
    console.error('[auth] Manual signout failed; falling back to next-auth signOut.', error);
  }

  // Fallback: no CSRF token, or the manual attempt threw. `signOut()` handles CSRF
  // itself and actually ends the session before redirecting.
  try {
    await signOut({ callbackUrl: target });
  } catch (fallbackError) {
    console.error('[auth] signOut fallback also failed; redirecting.', fallbackError);
    window.location.assign(target);
  }
}
