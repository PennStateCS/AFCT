/**
 * Tiny TTL memo for the status collectors. The status dashboard polls every ~15s,
 * but some probes are expensive and rarely change between polls: a blocking
 * `java -version` / evaluator-jar exec, DNS lookups, a TLS handshake. Wrapping
 * those in `cached(key, ttl, …)` means a poll reuses a recent result instead of
 * re-running the probe every time.
 *
 * Deliberately process-local and best-effort: a thrown producer is not cached,
 * and concurrent cold calls may both run (acceptable for a single-admin dashboard).
 */

type Entry<T> = { value: T; expires: number };

const store = new Map<string, Entry<unknown>>();

/**
 * Memoize an async producer under `key` for `ttlMs`.
 *
 * INVARIANT: `key` must come from a small, fixed set (the status collectors: versions,
 * network, ...). This store never evicts expired entries, so a per-user or per-request key
 * (`user:${id}`, `host:${name}`) would leak an entry per distinct value. Keep keys static;
 * if a dynamic key is ever needed, add expiry pruning here first.
 */
export async function cached<T>(key: string, ttlMs: number, produce: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = store.get(key) as Entry<T> | undefined;
  if (hit && hit.expires > now) return hit.value;
  const value = await produce();
  store.set(key, { value, expires: now + ttlMs });
  return value;
}

/** Drop all cached probe results (tests / hot reload). */
export function clearStatusCache(): void {
  store.clear();
}

/** Common TTLs, in ms. */
export const STATUS_TTL = {
  /** Tool versions (java, evaluator): effectively static for a running process. */
  versions: 5 * 60_000,
  /** DNS resolution + TLS certificate expiry: slow-changing infra facts. */
  network: 60_000,
} as const;
