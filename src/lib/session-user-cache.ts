import { prisma } from '@/lib/prisma';

/**
 * A very short-lived cache for the per-request "fresh user" lookup in the NextAuth session
 * callback.
 *
 * `auth()` runs on nearly every authenticated request, and its callback re-reads the user to
 * catch three things a JWT cannot express: the account was deleted or disabled, the password
 * changed (a reset must kill existing sessions), or admin was revoked. That is worth keeping,
 * but one dashboard load fans out into several parallel calls, each repeating the read.
 *
 * The TTL is seconds rather than minutes because it is a revocation lag: trusting the JWT for
 * five minutes would give a disabled account a five-minute grace period and quietly break
 * password-reset revocation. Seconds collapse the fan-out to one query and keep the worst case
 * small.
 *
 * Usually it is immediate anyway. Everything that disables an account, resets a password or
 * changes admin calls `invalidateSessionUser()`, so the next request re-reads at once; missing
 * one of those sites degrades to "revoked within the TTL", never to "not revoked".
 *
 * In-process, so it is coherent for the single-container deployment this ships as. Behind
 * several replicas each process keeps its own copy and the TTL becomes the real bound.
 */

export const SESSION_USER_TTL_MS = 15_000;

/** Exactly the columns the session callback needs. */
export type SessionUserRow = {
  firstName: string | null;
  lastName: string | null;
  isAdmin: boolean;
  avatar: string | null;
  temporaryPassword: boolean;
  /**
   * Whether a local password exists at all. Only the fact, never the hash.
   *
   * Needed because "must change a temporary password" is meaningless on an account that has no
   * password to change, and forcing it there sends somebody to a form they cannot complete and
   * cannot navigate away from.
   */
  hasPassword: boolean;
  inactive: boolean;
  passwordChangedAt: Date | null;
  cropX: number | null;
  cropY: number | null;
  zoom: number | null;
};

const SESSION_USER_SELECT = {
  firstName: true,
  lastName: true,
  isAdmin: true,
  avatar: true,
  temporaryPassword: true,
  // Selected to be reduced to a boolean below; the hash never leaves this module.
  password: true,
  inactive: true,
  passwordChangedAt: true,
  cropX: true,
  cropY: true,
  zoom: true,
} as const;

/**
 * The in-flight promise is what is cached, not just the settled value. A dashboard load
 * fires its API calls in parallel, so they all arrive before any of them has finished
 * reading; caching only the result would let every one of them issue its own query and
 * defeat the point. Sharing the promise collapses that burst into a single round trip.
 */
type Entry = { promise: Promise<SessionUserRow | null>; expiresAt: number };

const cache = new Map<string, Entry>();

// Entries expire logically after the TTL but are only physically removed when the same
// user returns or is explicitly invalidated, so over a long process the map could retain
// one entry per user who ever authenticated. Bounded by the user count (small for a
// course tool), but keep it tidy anyway: a cheap hard cap on every call plus a throttled
// pass that drops logically-expired entries.
const MAX_SESSION_CACHE_ENTRIES = 10_000;
let opsSincePrune = 0;

function pruneSessionCache(now: number): void {
  // Hard cap, every call: evict oldest-inserted until under the cap. O(1) amortized.
  while (cache.size > MAX_SESSION_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  // Full expired-entry pass is O(n); throttle it since entries live only ~15s.
  if (++opsSincePrune < 250) return;
  opsSincePrune = 0;
  for (const [userId, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(userId);
  }
}

/**
 * Read the session-relevant user row, reusing a recent (or still in-flight) read.
 * A missing user is cached as `null` too, so a deleted account does not turn into a
 * database read on every subsequent request.
 */
export function getSessionUser(
  userId: string,
  now: number = Date.now(),
): Promise<SessionUserRow | null> {
  pruneSessionCache(now);

  const hit = cache.get(userId);
  if (hit && hit.expiresAt > now) return hit.promise;

  const promise = prisma.user
    .findUnique({ where: { id: userId }, select: SESSION_USER_SELECT })
    /**
     * The hash is reduced to a boolean and then dropped, so the cached row never holds it.
     *
     * Destructured out rather than spread over: `{ ...u, hasPassword }` would leave the hash
     * sitting on an object that is cached, shared by every request in the window, and handed
     * to the session callback. Nothing reads it today, and that is exactly the kind of thing
     * a later change carries into a response by accident.
     */
    .then((u) => {
      if (!u) return null;
      const { password, ...rest } = u;
      return { ...rest, hasPassword: Boolean(password) } satisfies SessionUserRow;
    })
    .catch((err) => {
      // Never cache a failure: the caller treats a throw as "cannot verify" and
      // degrades privileges, and the next request should get a real attempt.
      cache.delete(userId);
      throw err;
    });

  cache.set(userId, { promise, expiresAt: now + SESSION_USER_TTL_MS });
  return promise;
}

/**
 * Drop a user's cached row. Call this from anything that changes whether or how they may
 * sign in: deactivation, deletion, password change/reset, or an admin-flag change.
 */
export function invalidateSessionUser(userId: string): void {
  cache.delete(userId);
}

/** Drop everything (used by tests, and safe to call at any time). */
export function clearSessionUserCache(): void {
  cache.clear();
  opsSincePrune = 0;
}
