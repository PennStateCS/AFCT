/**
 * One launch, from the login the platform initiates to the token it posts back.
 *
 * The state and the nonce were two unrelated single-use tokens. Each proved it was AFCT's and
 * unspent, and neither proved they belonged to the same launch, to the same registration, or to
 * the target link URI the platform asked for. Those are the checks LTI Core asks for and they
 * need the four values on one row.
 *
 * Only hashes are stored. The plaintext state travels in the browser and the plaintext nonce
 * travels in the id_token, so a leaked database should not let either be forged.
 */

import crypto from 'crypto';
import { prisma } from '@/lib/prisma';

/** Long enough for a redirect to the LMS and back, not for a sign-in session. */
export const LAUNCH_TTL_MS = 10 * 60 * 1000;

const hash = (value: string): string => crypto.createHash('sha256').update(value).digest('hex');

/** 32 bytes, so neither value can be guessed. */
const secret = (): string => crypto.randomBytes(32).toString('base64url');

export type StartedLaunch = { state: string; nonce: string };

/** Begin a launch and hand back the two secrets the redirect needs. */
export async function startLaunch(opts: {
  platformId: string;
  targetLinkUri?: string | null;
  /** The frame the platform named for browser storage, when it offered one. */
  storageTarget?: string | null;
  ttlMs?: number;
}): Promise<StartedLaunch> {
  const state = secret();
  const nonce = secret();

  await prisma.ltiLaunchTransaction.create({
    data: {
      stateHash: hash(state),
      nonceHash: hash(nonce),
      platformId: opts.platformId,
      targetLinkUri: opts.targetLinkUri?.trim() || null,
      storageTarget: opts.storageTarget?.trim() || null,
      expiresAt: new Date(Date.now() + (opts.ttlMs ?? LAUNCH_TTL_MS)),
    },
  });

  return { state, nonce };
}

export type LaunchTransaction = {
  id: string;
  platformId: string;
  nonceHash: string;
  targetLinkUri: string | null;
  storageTarget: string | null;
  idToken: string | null;
};

/**
 * Why a state did not name a launch that can still be completed.
 *
 * Three situations, and the difference matters to whoever has to fix it. A launch left open too
 * long is somebody signing in slowly; a spent one is the same launch arriving twice; a state
 * nobody issued is neither of those. What the person is told to do is the same either way, but
 * the log has to be able to tell them apart.
 */
export type LaunchLookupFailure = 'unknown' | 'spent' | 'timed-out';

export type FoundLaunch =
  { ok: true; launch: LaunchTransaction } | { ok: false; reason: LaunchLookupFailure };

/**
 * The launch this state belongs to, if it is one AFCT started and has not finished.
 *
 * Read rather than spent: the caller has more to check, and a launch that fails one of those
 * checks should be retryable rather than burned.
 */
export async function findLaunch(state: string): Promise<FoundLaunch> {
  const row = await prisma.ltiLaunchTransaction.findUnique({
    where: { stateHash: hash(state) },
    select: {
      id: true,
      platformId: true,
      nonceHash: true,
      targetLinkUri: true,
      storageTarget: true,
      idToken: true,
      usedAt: true,
      expiresAt: true,
    },
  });
  if (!row) return { ok: false, reason: 'unknown' };
  if (row.usedAt) return { ok: false, reason: 'spent' };
  if (row.expiresAt.getTime() <= Date.now()) return { ok: false, reason: 'timed-out' };
  return {
    ok: true,
    launch: {
      id: row.id,
      platformId: row.platformId,
      nonceHash: row.nonceHash,
      targetLinkUri: row.targetLinkUri,
      storageTarget: row.storageTarget,
      idToken: row.idToken,
    },
  };
}

/**
 * Hold the signed token while the browser is asked for the launch's state.
 *
 * Only reached when the state cookie did not arrive and the platform offered browser storage.
 * Written once and only onto a launch that is still open, so a second attempt cannot overwrite
 * a token already waiting, and cleared as soon as the launch is spent.
 */
export async function parkIdToken(id: string, idToken: string): Promise<boolean> {
  const { count } = await prisma.ltiLaunchTransaction.updateMany({
    where: { id, usedAt: null, idToken: null },
    data: { idToken },
  });
  return count === 1;
}

/** Whether this nonce is the one issued for this launch. */
export function nonceMatches(transaction: LaunchTransaction, nonce: string): boolean {
  const given = hash(nonce);
  // Both are hex digests of the same length, so a plain comparison leaks nothing useful, but
  // timing-safe is the habit worth keeping around secrets.
  return (
    given.length === transaction.nonceHash.length &&
    crypto.timingSafeEqual(Buffer.from(given), Buffer.from(transaction.nonceHash))
  );
}

/**
 * Spend the launch, once.
 *
 * A conditional update rather than a read followed by a write: two copies of the same launch
 * arriving together would both pass a check-then-act, and exactly one passes this.
 */
export async function consumeLaunch(id: string): Promise<boolean> {
  const { count } = await prisma.ltiLaunchTransaction.updateMany({
    where: { id, usedAt: null },
    // The parked token goes with it. A signed token must not outlive the launch it belongs to,
    // and after this it can never be used again anyway.
    data: { usedAt: new Date(), idToken: null },
  });
  return count === 1;
}

/** Sweep spent and expired launches. Called by the same job that prunes single-use tokens. */
export async function purgeExpiredLaunches(graceMs = 7 * 24 * 60 * 60 * 1000): Promise<number> {
  const { count } = await prisma.ltiLaunchTransaction.deleteMany({
    where: { expiresAt: { lt: new Date(Date.now() - graceMs) } },
  });
  return count;
}
