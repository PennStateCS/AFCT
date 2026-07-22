import { prisma } from '@/lib/prisma';

/**
 * A very short-lived cache for the per-request "fresh user" lookup in the NextAuth
 * session callback.
 *
 * WHY THIS EXISTS
 * `auth()` runs on essentially every authenticated API request, and its session callback
 * re-reads the user to catch three things a JWT cannot express on its own:
 *   - the account was deleted or disabled,
 *   - the password changed (a reset must kill existing sessions, not just future ones),
 *   - admin was revoked.
 * That correctness is worth keeping. But a single dashboard load fans out into several
 * parallel API calls, so the same user was being read once per call, every time.
 *
 * WHY THE TTL IS SECONDS, NOT MINUTES
 * The obvious "just trust the JWT for 5-10 minutes" would give a deleted, disabled, or
 * de-admined account a multi-minute grace period, and would silently break the
 * password-reset revocation control. A few seconds collapses the fan-out (the common
 * case: N parallel requests -> 1 query) while keeping the worst-case revocation lag
 * small and bounded.
 *
 * ...AND WHY IT IS USUALLY IMMEDIATE ANYWAY
 * The TTL is only the backstop. Anything in this app that disables an account, resets a
 * password, or changes admin calls `invalidateSessionUser()`, so the next request
 * re-reads from the database straight away. Missing an invalidation site degrades to
 * "revoked within TTL_MS", never to "not revoked".
 *
 * SCOPE: in-process, so it is coherent for the single-container deployment this ships
 * as. Behind multiple replicas each process keeps its own copy and the TTL becomes the
 * real bound; that is still seconds, but worth remembering before scaling out.
 */

export const SESSION_USER_TTL_MS = 15_000;

/** Exactly the columns the session callback needs. */
export type SessionUserRow = {
  firstName: string | null;
  lastName: string | null;
  isAdmin: boolean;
  avatar: string | null;
  temporaryPassword: boolean;
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
    .then((u) => u as SessionUserRow | null)
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
