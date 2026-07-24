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
 * (`user:${id}`, `host:${name}`) would leak an entry per distinct value. For a key with a
 * dynamic part, use {@link boundedCache} instead, which caps its own size.
 */
export async function cached<T>(key: string, ttlMs: number, produce: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = store.get(key) as Entry<T> | undefined;
  if (hit && hit.expires > now) return hit.value;
  const value = await produce();
  store.set(key, { value, expires: now + ttlMs });
  return value;
}

/**
 * A memo for keys that are NOT from a fixed set: one host, one IP address, one
 * container. Each call site gets its own instance with its own cap, so a flood of
 * distinct keys evicts inside that cache instead of pushing out an unrelated probe.
 * Eviction is oldest-first (Map preserves insertion order), which is enough for
 * probe results: they all expire on their own anyway, and the cap only ever bites
 * under abuse.
 *
 * Use this rather than {@link cached} whenever part of the key comes from a request,
 * a database row, or the network.
 */
export function boundedCache<T>(opts: { max: number; ttlMs: number }) {
  const local = new Map<string, Entry<T>>();
  const instance = {
    async get(key: string, produce: () => Promise<T>): Promise<T> {
      const now = Date.now();
      const hit = local.get(key);
      if (hit && hit.expires > now) return hit.value;
      const value = await produce();
      while (local.size >= opts.max) {
        const oldest = local.keys().next().value as string | undefined;
        if (oldest === undefined) break;
        local.delete(oldest);
      }
      local.set(key, { value, expires: now + opts.ttlMs });
      return value;
    },
    clear: () => local.clear(),
    /** Live entry count. Test-only observability for the cap. */
    size: () => local.size,
  };
  boundedCaches.push(instance);
  return instance;
}

// Registered so `clearStatusCache` resets every cache, not just the fixed-key store.
const boundedCaches: Array<{ clear: () => void }> = [];

/** Drop all cached probe results (tests / hot reload). */
export function clearStatusCache(): void {
  store.clear();
  boundedCaches.forEach((c) => c.clear());
}

/** Common TTLs, in ms. */
export const STATUS_TTL = {
  /** Tool versions (java, evaluator): effectively static for a running process. */
  versions: 5 * 60_000,
  /** DNS resolution + TLS certificate expiry: slow-changing infra facts. */
  network: 60_000,
} as const;
