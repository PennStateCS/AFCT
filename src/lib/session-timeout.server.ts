import { prisma } from '@/lib/prisma';
import { clampSessionTimeoutMinutes, DEFAULT_SESSION_TIMEOUT_MINUTES } from '@/lib/system-settings';
import { serverIdleTimeoutMs } from '@/lib/session-timeout';

/**
 * Server-side reader for the effective idle limit, in milliseconds, that gets
 * baked into the JWT. Kept separate from the pure `session-timeout` module so the
 * edge middleware can import the math without pulling Prisma into the edge bundle.
 *
 * Cached briefly so the auth `jwt` callback (which runs on every heartbeat) does
 * not hit the database each time; a settings change propagates within the TTL.
 */
const CACHE_TTL_MS = 30_000;
let cache: { value: number; expires: number } | null = null;

export async function getServerIdleTimeoutMs(now: number = Date.now()): Promise<number> {
  if (cache && cache.expires > now) return cache.value;

  let minutes = DEFAULT_SESSION_TIMEOUT_MINUTES;
  try {
    const settings = await prisma.systemSettings.findUnique({
      where: { id: 1 },
      select: { sessionTimeoutMinutes: true },
    });
    minutes = clampSessionTimeoutMinutes(
      Number(settings?.sessionTimeoutMinutes) || DEFAULT_SESSION_TIMEOUT_MINUTES,
    );
  } catch {
    // Fall back to the default on a transient DB error rather than baking a bad
    // (e.g. 0) limit into the token.
    minutes = DEFAULT_SESSION_TIMEOUT_MINUTES;
  }

  const value = serverIdleTimeoutMs(minutes);
  cache = { value, expires: now + CACHE_TTL_MS };
  return value;
}

/** Test hook: drop the memoized value so the next read hits the DB again. */
export function __resetIdleTimeoutCacheForTests() {
  cache = null;
}
