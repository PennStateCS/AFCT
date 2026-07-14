/**
 * Shared fetch helpers for TanStack Query `queryFn`s (and, later, `mutationFn`s).
 *
 * `fetchJson` throws an {@link HttpError} carrying the HTTP status on a non-2xx
 * response, so the shared retry policy ({@link retryUnlessClientError}) can skip
 * client errors (4xx): a 401/403/404 will never succeed on retry, so retrying
 * just delays the error and wastes a request. Pass the query's `AbortSignal`
 * through `init.signal` to get cancellation for free.
 *
 * Adopt incrementally: existing hand-written `fetch` query functions keep working.
 */

import { QUERY_DEBUG, noteClientFetch, logClientTiming } from '@/lib/perf-debug';

export class HttpError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.body = body;
  }
}

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  // Dev-only instrumentation (off unless NEXT_PUBLIC_QUERY_DEBUG=1); a no-op in
  // tests and production, so the fetch call shape below is unchanged.
  const method = init?.method ?? 'GET';
  const start = QUERY_DEBUG ? performance.now() : 0;
  if (QUERY_DEBUG) noteClientFetch(method, url);
  let statusForLog = 0;
  try {
    // Only pass `init` when present so the call reads as `fetch(url)` (no trailing
    // undefined); matches callers that pass no options.
    const res = await (init ? fetch(url, init) : fetch(url));
    statusForLog = res.status;
    if (!res.ok) {
      let body: unknown = null;
      let message = `Request failed (${res.status})`;
      try {
        body = await res.json();
        const parsed = (body as { error?: string; message?: string } | null) ?? null;
        const detail = parsed?.error ?? parsed?.message;
        if (detail) message = detail;
      } catch {
        // Non-JSON error body; keep the status-based message.
      }
      throw new HttpError(res.status, message, body);
    }
    return (await res.json()) as T;
  } finally {
    if (QUERY_DEBUG) logClientTiming(method, url, statusForLog, performance.now() - start);
  }
}

/**
 * Default retry policy: never retry a client error (4xx, e.g. auth/permission/
 * not-found), otherwise retry once. Errors without a known status (network/parse)
 * fall through to the single retry, matching the previous `retry: 1` default.
 */
export function retryUnlessClientError(failureCount: number, error: unknown): boolean {
  if (error instanceof HttpError && error.status >= 400 && error.status < 500) {
    return false;
  }
  return failureCount < 1;
}
