/**
 * Dev-only performance instrumentation.
 *
 * Everything here is a no-op unless a debug flag is explicitly set, and it logs
 * ONLY safe metadata: HTTP method, request *path* (query string stripped),
 * response status, elapsed milliseconds, and — on the client — a warning when
 * the same request fires twice in quick succession. It never logs request or
 * response bodies, names, emails, grades, submissions, tokens, roster contents,
 * or any query-string parameters.
 *
 * Flags (both default off):
 *   - NEXT_PUBLIC_QUERY_DEBUG=1  → client fetch timing + duplicate warnings
 *     (the NEXT_PUBLIC_ prefix inlines it into the browser bundle).
 *   - AFCT_PERF_DEBUG=1          → server API-route timing (via the auth wrappers).
 */

/** Client-side query debug (browser). */
export const QUERY_DEBUG = process.env.NEXT_PUBLIC_QUERY_DEBUG === '1';

/** Server-side perf debug (API route wrappers). */
export const SERVER_PERF_DEBUG = process.env.AFCT_PERF_DEBUG === '1';

/** Return just the path, dropping the query string so no param is ever logged. */
function pathOnly(url: string): string {
  try {
    return new URL(url, 'http://local').pathname;
  } catch {
    const q = url.indexOf('?');
    return q === -1 ? url : url.slice(0, q);
  }
}

// Duplicate-fetch detection state. Keyed by "METHOD full-url" (kept in memory
// only, never logged) so distinct query strings don't collide; the warning
// itself prints the path only.
const DUP_WINDOW_MS = 400;
const lastSeen = new Map<string, number>();

/**
 * Client: record that a fetch is starting and warn if the identical request
 * fired within {@link DUP_WINDOW_MS}. Cheap enough to call on every fetch; does
 * nothing unless {@link QUERY_DEBUG} is on.
 */
export function noteClientFetch(method: string, url: string): void {
  if (!QUERY_DEBUG) return;
  const key = `${method} ${url}`;
  const now = Date.now();
  const prev = lastSeen.get(key);
  if (prev !== undefined && now - prev < DUP_WINDOW_MS) {
    console.warn(`[query] duplicate fetch: ${method} ${pathOnly(url)} (${now - prev}ms apart)`);
  }
  lastSeen.set(key, now);
}

/** Client: log a completed fetch's timing. No-op unless {@link QUERY_DEBUG}. */
export function logClientTiming(method: string, url: string, status: number, ms: number): void {
  if (!QUERY_DEBUG) return;
  console.debug(`[query] ${method} ${pathOnly(url)} ${status} ${Math.round(ms)}ms`);
}

/**
 * Server: time a route handler and log method/path/status/ms. No-op (runs the
 * handler directly) unless {@link SERVER_PERF_DEBUG}.
 */
export async function withServerTiming<R extends Response>(
  req: Request,
  run: () => Promise<R> | R,
): Promise<R> {
  if (!SERVER_PERF_DEBUG) return run();
  const start = performance.now();
  const res = await run();
  console.debug(
    `[perf] ${req.method} ${pathOnly(req.url)} ${res.status} ${Math.round(performance.now() - start)}ms`,
  );
  return res;
}
