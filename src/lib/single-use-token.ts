/**
 * Tokens that work exactly once, within a time window.
 *
 * The password-reset link is the first user. Anything with the same shape should reuse this
 * rather than growing its own table: getting "hashed at rest, expiring, spent exactly once"
 * wrong once is better than getting it wrong three times.
 *
 * Two properties are the whole point, and both are enforced here rather than left to callers:
 *
 *   - **Only the hash is stored.** A leaked database, or a leaked backup, does not hand anyone
 *     a working link. The plaintext exists once, in the email that carries it.
 *   - **Spending is a conditional update, not a read followed by a write.** Two simultaneous
 *     clicks on the same link race, and a check-then-act would let both through. The update
 *     matches on `usedAt IS NULL` and succeeds for exactly one of them.
 */

import crypto from 'crypto';
import { prisma } from '@/lib/prisma';
import type { Prisma, SingleUseTokenPurpose } from '@prisma/client';

export type { SingleUseTokenPurpose };

/**
 * 32 random bytes, base64url so it survives a URL without escaping. Long enough that guessing
 * is not a threat model worth discussing.
 */
const TOKEN_BYTES = 32;

/** How long a password-reset link stays valid. Short: it is a recovery path, not a session. */
export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000; // 1 hour

/** SHA-256 hex of the raw token: the only form persisted. Mirrors `client-auth.hashToken`. */
export function hashSingleUseToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

export type IssuedToken = {
  /** Plaintext token, returned exactly once and never stored. Put this in the link. */
  token: string;
  expiresAt: Date;
};

/**
 * Issue a token for a purpose, optionally tied to a user.
 *
 * Pass a transaction client when the issue has to be atomic with something else; otherwise the
 * default client is fine.
 */
export async function issueSingleUseToken(opts: {
  purpose: SingleUseTokenPurpose;
  userId?: string | null;
  ttlMs: number;
  tx?: Prisma.TransactionClient;
}): Promise<IssuedToken> {
  const client = opts.tx ?? prisma;
  const token = crypto.randomBytes(TOKEN_BYTES).toString('base64url');
  const expiresAt = new Date(Date.now() + opts.ttlMs);

  await client.singleUseToken.create({
    data: {
      tokenHash: hashSingleUseToken(token),
      purpose: opts.purpose,
      userId: opts.userId ?? null,
      expiresAt,
    },
  });

  return { token, expiresAt };
}

export type ConsumedToken = {
  id: string;
  userId: string | null;
};

/**
 * Spend a token, returning what it was issued for, or null when it cannot be spent.
 *
 * Null covers every rejection deliberately: unknown, expired, already used, or issued for a
 * different purpose. A caller must not be able to tell those apart, because the difference is
 * exactly what tells an attacker whether a token existed.
 *
 * The purpose is part of the match, so a token minted for one thing can never be redeemed for
 * another even if a future caller passes it to the wrong function.
 */
export async function consumeSingleUseToken(opts: {
  token: string;
  purpose: SingleUseTokenPurpose;
  tx?: Prisma.TransactionClient;
}): Promise<ConsumedToken | null> {
  const client = opts.tx ?? prisma;
  const tokenHash = hashSingleUseToken(opts.token);
  const now = new Date();

  // The guard is this `where`, not a preceding read. `usedAt: null` means exactly one of two
  // simultaneous redemptions updates a row; the loser sees count 0 and is refused.
  const { count } = await client.singleUseToken.updateMany({
    where: {
      tokenHash,
      purpose: opts.purpose,
      usedAt: null,
      expiresAt: { gt: now },
    },
    data: { usedAt: now },
  });
  if (count !== 1) return null;

  const row = await client.singleUseToken.findUnique({
    where: { tokenHash },
    select: { id: true, userId: true },
  });
  return row ?? null;
}

/**
 * Withdraw every outstanding token of a purpose for one user.
 *
 * Used when a reset completes, so a second link someone requested earlier cannot still be
 * redeemed, and when an account is disabled. Marks them used rather than deleting them, so the
 * fact that they existed survives for the audit trail.
 */
export async function revokeSingleUseTokens(opts: {
  userId: string;
  purpose: SingleUseTokenPurpose;
  tx?: Prisma.TransactionClient;
}): Promise<number> {
  const client = opts.tx ?? prisma;
  const { count } = await client.singleUseToken.updateMany({
    where: { userId: opts.userId, purpose: opts.purpose, usedAt: null },
    data: { usedAt: new Date() },
  });
  return count;
}

/**
 * Delete tokens that expired a while ago.
 *
 * Kept past expiry rather than deleted on the spot: a support question is usually "why didn't
 * my link work", and a row that says it expired at 3pm answers it. The grace period is short
 * because these are worthless once expired.
 */
export const EXPIRED_TOKEN_GRACE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export async function purgeExpiredSingleUseTokens(): Promise<number> {
  const cutoff = new Date(Date.now() - EXPIRED_TOKEN_GRACE_MS);
  const { count } = await prisma.singleUseToken.deleteMany({
    where: { expiresAt: { lt: cutoff } },
  });
  return count;
}
