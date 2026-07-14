// src/lib/api/fetch-client.ts
//
// Browser-side fetch helpers. Every dialog and column file was hand-rolling the same
// sequence: fetch, check `res.ok`, pull the server's `{ error }` message out of the
// body, throw/toast on failure, parse JSON on success. This centralizes that so call
// sites read as one intent-revealing line and error handling can't drift.
//
// Client-only: `mutateWithToast` imports the toast layer. Server route code uses the
// `lib/api/http` + `lib/api/activity` toolkit instead; nothing server-side imports
// this module.
import { showToast } from '@/lib/toast';
import { errMessage } from '@/lib/errors';

/** A failed HTTP response, carrying the parsed status and the server's error message. */
export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

type ApiFetchInit = Omit<RequestInit, 'body'> & {
  /** JSON body: stringified, with `Content-Type: application/json` set for you. */
  json?: unknown;
  /** Raw body (e.g. FormData). The browser sets the multipart boundary itself. */
  form?: BodyInit;
};

/**
 * `fetch` that resolves to the parsed JSON body on success and throws an `ApiError`
 * (with the server's `{ error }` message, when present) on any non-2xx. Returns
 * `undefined` for empty/204 responses.
 */
export async function apiFetch<T = unknown>(input: string, init: ApiFetchInit = {}): Promise<T> {
  const { json, form, headers, ...rest } = init;
  const finalHeaders = new Headers(headers);

  let body: BodyInit | undefined;
  if (json !== undefined) {
    finalHeaders.set('Content-Type', 'application/json');
    body = JSON.stringify(json);
  } else if (form !== undefined) {
    body = form;
  }

  const res = await fetch(input, { ...rest, headers: finalHeaders, body });

  if (!res.ok) {
    const errorBody: unknown = await res.json().catch(() => null);
    const serverError =
      errorBody && typeof errorBody === 'object'
        ? (errorBody as Record<string, unknown>).error
        : undefined;
    const message = typeof serverError === 'string' ? serverError : `Request failed (${res.status})`;
    throw new ApiError(message, res.status, errorBody);
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/** Verb-shaped convenience wrappers over {@link apiFetch}. */
export const apiClient = {
  get: <T = unknown>(url: string) => apiFetch<T>(url),
  post: <T = unknown>(url: string, json?: unknown) => apiFetch<T>(url, { method: 'POST', json }),
  put: <T = unknown>(url: string, json?: unknown) => apiFetch<T>(url, { method: 'PUT', json }),
  patch: <T = unknown>(url: string, json?: unknown) => apiFetch<T>(url, { method: 'PATCH', json }),
  del: <T = unknown>(url: string) => apiFetch<T>(url, { method: 'DELETE' }),
  postForm: <T = unknown>(url: string, form: BodyInit) =>
    apiFetch<T>(url, { method: 'POST', form }),
  putForm: <T = unknown>(url: string, form: BodyInit) => apiFetch<T>(url, { method: 'PUT', form }),
  patchForm: <T = unknown>(url: string, form: BodyInit) =>
    apiFetch<T>(url, { method: 'PATCH', form }),
};

export type MutateResult<T> = { ok: true; data: T } | { ok: false; error: string };

/**
 * Run a mutation, toasting success/failure, and return a discriminated result so the
 * caller can branch (close a dialog, refresh a list) only on success, without its own
 * try/catch. Replaces the repeated `try { … showToast.success } catch (e) {
 * showToast.error(e instanceof Error ? e.message : 'Network error') }` block.
 */
export async function mutateWithToast<T>(
  action: () => Promise<T>,
  opts: { success?: string; error?: string } = {},
): Promise<MutateResult<T>> {
  try {
    const data = await action();
    if (opts.success) showToast.success(opts.success);
    return { ok: true, data };
  } catch (e) {
    const message = errMessage(e, opts.error ?? 'Network error');
    showToast.error(message);
    return { ok: false, error: message };
  }
}
