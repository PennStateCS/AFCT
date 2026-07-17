/**
 * Sanitizes a post-login `callbackUrl` into a safe redirect target.
 *
 * Only same-origin *relative* paths are allowed — a single leading slash — so the
 * value can never send the user to another site (open redirect). Protocol-relative
 * (`//host`), backslash tricks (`/\host`), and absolute URLs (`https://…`,
 * `javascript:…`) all fall back to the default. The query string is preserved, which
 * is what lets a link like `/dashboard?joinCode=XXXXXXXX` survive the login bounce.
 */
export function safeCallbackUrl(raw: string | null | undefined, fallback = '/dashboard'): string {
  if (!raw || typeof raw !== 'string') return fallback;
  if (!raw.startsWith('/')) return fallback; // absolute URL or scheme (https:, javascript:)
  if (raw.startsWith('//') || raw.startsWith('/\\')) return fallback; // protocol-relative / backslash
  if (/[\x00-\x1f]/.test(raw)) return fallback; // control chars (newline-injection guard)
  return raw;
}
