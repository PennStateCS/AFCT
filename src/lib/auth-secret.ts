/**
 * Resolve and validate the NextAuth JWT signing secret.
 *
 * The secret signs every session token, so a missing or weak value means tokens
 * are forgeable — a full auth-bypass / admin-impersonation risk. NextAuth only
 * errors on a *missing* secret, and only when it first verifies a token; this
 * guard additionally rejects a *weak* (short) secret and fails fast at the point
 * of use so a misconfigured deployment is caught immediately rather than on the
 * first login.
 *
 * Kept dependency-free (reads `process.env` only) so it is safe to import from
 * the edge runtime (`src/proxy.ts`) as well as the Node server (`src/lib/auth.ts`).
 */

/** Minimum acceptable secret length. `openssl rand -base64 32` yields 44 chars. */
export const MIN_AUTH_SECRET_LENGTH = 32;

export function requireAuthSecret(): string {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret || secret.length < MIN_AUTH_SECRET_LENGTH) {
    throw new Error(
      `NEXTAUTH_SECRET is missing or too short (need at least ${MIN_AUTH_SECRET_LENGTH} characters). ` +
        'Generate one with `openssl rand -base64 32` and set it in the environment.',
    );
  }
  return secret;
}
