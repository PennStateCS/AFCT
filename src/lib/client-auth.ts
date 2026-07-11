// src/lib/client-auth.ts
//
// Bearer-token auth for the native submission client (the Java app). The browser
// uses NextAuth session cookies; native clients get one of these tokens instead —
// they avoid CSRF and the browser idle-timeout, and are revocable/expirable.
//
// Only the SHA-256 hash of a token is ever stored. The plaintext is returned once,
// at issue time, and never persisted.
import crypto from 'crypto';
import { prisma } from '@/lib/prisma';

/** How long a freshly issued client token is valid. */
export const CLIENT_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/** Bump `lastUsedAt` at most this often, to avoid a write on every request. */
const LAST_USED_THROTTLE_MS = 5 * 60 * 1000; // 5 minutes

/** SHA-256 hex of the raw token — the only form persisted. */
export function hashToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

export type IssuedClientToken = {
  /** Plaintext token — returned to the caller exactly once, never stored. */
  token: string;
  tokenId: string;
  expiresAt: Date;
};

/** Issue a new bearer token for a user and persist only its hash. */
export async function issueClientToken(
  userId: string,
  opts: { label?: string | null; ttlMs?: number } = {},
): Promise<IssuedClientToken> {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + (opts.ttlMs ?? CLIENT_TOKEN_TTL_MS));
  const row = await prisma.clientApiToken.create({
    data: { tokenHash: hashToken(token), userId, label: opts.label ?? null, expiresAt },
    select: { id: true },
  });
  return { token, tokenId: row.id, expiresAt };
}

/** The token owner, shaped to compose with the `@/lib/permissions` helpers. */
export type ClientTokenUser = {
  id: string;
  isAdmin: boolean;
  email: string;
  firstName: string | null;
  lastName: string | null;
};

export type ResolvedClientToken = { tokenId: string; user: ClientTokenUser };

/**
 * Resolve a raw bearer token to its active user, or `null` if the token is unknown,
 * expired, revoked, or the user is missing/inactive. Bumps `lastUsedAt` (throttled,
 * best-effort — a write failure never fails the request).
 */
export async function resolveClientToken(rawToken: string): Promise<ResolvedClientToken | null> {
  if (!rawToken) return null;
  const row = await prisma.clientApiToken.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    select: {
      id: true,
      revokedAt: true,
      expiresAt: true,
      lastUsedAt: true,
      user: {
        select: {
          id: true,
          isAdmin: true,
          email: true,
          firstName: true,
          lastName: true,
          inactive: true,
        },
      },
    },
  });
  if (!row) return null;

  const now = Date.now();
  if (row.revokedAt) return null;
  if (row.expiresAt && row.expiresAt.getTime() <= now) return null;
  if (!row.user || row.user.inactive) return null;

  // Sliding expiration: any authenticated request pushes the expiry out to
  // `now + TTL`, so an actively-used token stays valid and only genuine inactivity
  // (no call for a full TTL window) lets it lapse. Throttled + best-effort so it's at
  // most one extra write every few minutes and never fails the request.
  if (!row.lastUsedAt || now - row.lastUsedAt.getTime() > LAST_USED_THROTTLE_MS) {
    void prisma.clientApiToken
      .update({
        where: { id: row.id },
        data: { lastUsedAt: new Date(now), expiresAt: new Date(now + CLIENT_TOKEN_TTL_MS) },
      })
      .catch(() => {});
  }

  const { inactive: _inactive, ...user } = row.user;
  return { tokenId: row.id, user };
}

/** Revoke a token by id (idempotent — a no-op if already revoked/gone). */
export async function revokeClientToken(tokenId: string): Promise<void> {
  await prisma.clientApiToken.updateMany({
    where: { id: tokenId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
