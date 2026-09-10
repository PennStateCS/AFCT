import crypto from 'crypto';
import { prisma } from '@/lib/prisma';

/**
 * Single-use authorization codes for the desktop client's browser sign-in
 * (authorization code + PKCE over a loopback redirect, RFC 8252).
 *
 * The code only has to survive one browser redirect and one exchange call, so its
 * life is minutes. Everything a hostile local process could tamper with (the
 * redirect target, the PKCE pair) is validated when the code is issued AND again
 * at exchange against what was stored, never against what the exchange request
 * claims on its own.
 */

/** Covers the redirect and the exchange, not the student's MFA: that wait happens
 *  before Allow is clicked, and this clock starts at Allow. */
export const CLIENT_AUTH_CODE_TTL_MS = 2 * 60 * 1000;

const sha256Hex = (value: string) => crypto.createHash('sha256').update(value).digest('hex');

/**
 * Accepts only `http://127.0.0.1:<port>/...` and `http://[::1]:<port>/...`.
 * Not `localhost`: a hosts file or hostile resolver can point it off this machine,
 * which turns "the code goes back to the app that asked" into an open redirect.
 * Plain http is correct here (RFC 8252 §7.3): the hop never leaves the machine and
 * a certificate for a random loopback port cannot exist. Userinfo and query are
 * refused because neither has any business in a redirect target we will append a
 * query to. Returns the normalized URI to store, or null.
 */
export function validateClientRedirectUri(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:') return null;
  if (url.hostname !== '127.0.0.1' && url.hostname !== '[::1]') return null;
  if (url.username !== '' || url.password !== '') return null;
  if (url.search !== '' || url.hash !== '') return null;
  return url.toString();
}

/** RFC 7636 S256: base64url(sha256(verifier)) must equal the stored challenge. */
export function verifyPkce(storedChallenge: string, verifier: string): boolean {
  const computed = crypto.createHash('sha256').update(verifier).digest('base64url');
  const a = Buffer.from(computed);
  const b = Buffer.from(storedChallenge);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function createClientAuthCode(
  userId: string,
  opts: { pkceChallenge: string; redirectUri: string; deviceName?: string | null },
): Promise<{ code: string; expiresAt: Date }> {
  const code = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + CLIENT_AUTH_CODE_TTL_MS);
  await prisma.clientAuthCode.create({
    data: {
      codeHash: sha256Hex(code),
      userId,
      pkceChallenge: opts.pkceChallenge,
      redirectUri: opts.redirectUri,
      deviceName: opts.deviceName ?? null,
      expiresAt,
    },
  });
  return { code, expiresAt };
}

export type ExchangeResult =
  | { ok: true; userId: string; deviceName: string | null }
  | {
      ok: false;
      /** For the log; the response to the caller stays generic on purpose. */
      reason: 'unknown_code' | 'replayed' | 'expired' | 'redirect_mismatch' | 'pkce_mismatch';
    };

/**
 * Redeems a code. Single use is enforced by the database (`usedAt` claimed with a
 * guarded update), not by check-then-act: two racing exchanges get one token and
 * one refusal. The PKCE check runs before the claim so a wrong verifier does not
 * burn the code for the process that actually holds it.
 */
export async function exchangeClientAuthCode(params: {
  code: string;
  codeVerifier: string;
  redirectUri: string;
}): Promise<ExchangeResult> {
  const row = await prisma.clientAuthCode.findUnique({
    where: { codeHash: sha256Hex(params.code) },
  });
  if (!row) return { ok: false, reason: 'unknown_code' };
  if (row.usedAt) return { ok: false, reason: 'replayed' };
  if (row.expiresAt.getTime() <= Date.now()) return { ok: false, reason: 'expired' };
  // Exact match against the stored value; the exchange request's own claim proves nothing.
  if (row.redirectUri === null || row.redirectUri !== params.redirectUri) {
    return { ok: false, reason: 'redirect_mismatch' };
  }
  if (!verifyPkce(row.pkceChallenge, params.codeVerifier)) {
    return { ok: false, reason: 'pkce_mismatch' };
  }

  const claimed = await prisma.clientAuthCode.updateMany({
    where: { id: row.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (claimed.count === 0) return { ok: false, reason: 'replayed' };

  return { ok: true, userId: row.userId, deviceName: row.deviceName };
}
