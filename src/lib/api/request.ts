/**
 * Small helpers for pulling typed values out of an incoming request: a validated
 * JSON body, query-param pagination, and multipart-form flags, plus the
 * bounded-integer coercion they build on. Centralizes idioms that had been
 * re-implemented (and occasionally mis-implemented) across route handlers.
 */

import type { NextResponse } from 'next/server';
import type { ZodType } from 'zod';
import { apiError } from './http';

/**
 * Default ceiling for a JSON body. Every JSON route in this app sends small objects
 * (credentials, ids, settings), so 64 KB is generous. File uploads go through
 * multipart routes, which have their own size checks against the configured upload
 * limit -- this bound deliberately does not apply to them.
 */
export const MAX_JSON_BODY_BYTES = 64 * 1024;

/**
 * Read a request body as text without letting it grow past `maxBytes`.
 *
 * Two gates, because either alone is insufficient:
 *  1. `Content-Length`, when present, is rejected up front so an oversized body is
 *     refused before a single byte is buffered.
 *  2. The stream is then read incrementally and aborted the moment the running total
 *     exceeds the cap, because `Content-Length` is optional (chunked encoding) and is
 *     attacker-controlled anyway.
 *
 * Returns 413 rather than 400: the body was well-formed, just too large.
 */
async function readBodyText(
  req: Request,
  maxBytes: number,
): Promise<{ ok: true; text: string } | { ok: false; response: NextResponse }> {
  const tooLarge = () => ({
    ok: false as const,
    response: apiError(413, 'Request body too large'),
  });

  const declared = Number(req.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > maxBytes) return tooLarge();

  const body = req.body;
  // No stream to meter (e.g. a mocked Request in tests): fall back to text(), which the
  // Content-Length check above has already bounded when the header was present.
  if (!body) {
    try {
      const text = await req.text();
      if (Buffer.byteLength(text) > maxBytes) return tooLarge();
      return { ok: true, text };
    } catch {
      return { ok: false, response: apiError(400, 'Invalid JSON body') };
    }
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        return tooLarge();
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, response: apiError(400, 'Invalid JSON body') };
  }

  return { ok: true, text: Buffer.concat(chunks).toString('utf8') };
}

/**
 * Parse and validate a JSON request body against a Zod schema. Returns a discriminated
 * result: `{ ok: true, data }` with the typed, validated body, or `{ ok: false,
 * response }` (a ready-to-return **400** for malformed JSON or a schema mismatch).
 * Never throws, so a handler can `if (!parsed.ok) return parsed.response;` and move on.
 */
export async function readJson<T>(
  req: Request,
  schema: ZodType<T>,
  { maxBytes = MAX_JSON_BODY_BYTES }: { maxBytes?: number } = {},
): Promise<{ ok: true; data: T } | { ok: false; response: NextResponse }> {
  const oversize = await readBodyText(req, maxBytes);
  if (!oversize.ok) return oversize;

  let raw: unknown;
  try {
    raw = JSON.parse(oversize.text);
  } catch {
    return { ok: false, response: apiError(400, 'Invalid JSON body') };
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const first = result.error.issues[0];
    const detail = first
      ? `${first.path.join('.') || 'body'}: ${first.message}`
      : 'Validation failed';
    return { ok: false, response: apiError(400, detail) };
  }
  return { ok: true, data: result.data };
}

/**
 * Like {@link readJson} but for multipart bodies. Reads the `FormData`, collapses
 * it into a plain object of `string | File` values, and validates it against a Zod
 * schema (use the coercing primitives in `@/schemas/fields` for booleans/ints).
 * Returns the validated data plus the raw `FormData` (handlers still need it for
 * files and repeated keys). Never throws; a bad body yields a ready 400.
 */
export async function readFormData<T>(
  req: Request,
  schema: ZodType<T>,
): Promise<{ ok: true; data: T; form: FormData } | { ok: false; response: NextResponse }> {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return { ok: false, response: apiError(400, 'Invalid form data') };
  }
  const raw: Record<string, FormDataEntryValue> = {};
  // Last value wins for a repeated key; handlers that need every value read the
  // returned `form` directly.
  for (const [key, value] of form.entries()) {
    raw[key] = value;
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const first = result.error.issues[0];
    const detail = first
      ? `${first.path.join('.') || 'body'}: ${first.message}`
      : 'Validation failed';
    return { ok: false, response: apiError(400, detail) };
  }
  return { ok: true, data: result.data, form };
}

/** Coerce to an integer clamped to `[min, max]`; non-finite input yields `fallback`. */
export function clampInt(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

export type PageParams = { page: number; pageSize: number; skip: number; take: number };

/**
 * Parse `page`/`pageSize` for offset pagination. A missing param falls back to the
 * default (guarding the `Number(null) === 0` trap); `pageSize` is clamped to
 * `[1, maxSize]` and `page` to `>= 1`. Also returns Prisma-ready `skip`/`take`.
 */
export function parsePageParams(
  searchParams: URLSearchParams,
  opts: { defaultSize: number; maxSize: number },
): PageParams {
  const pageRaw = searchParams.get('page');
  const sizeRaw = searchParams.get('pageSize');
  const page = pageRaw ? clampInt(Number(pageRaw), 1, Number.MAX_SAFE_INTEGER, 1) : 1;
  const pageSize = sizeRaw
    ? clampInt(Number(sizeRaw), 1, opts.maxSize, opts.defaultSize)
    : opts.defaultSize;
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

export type LimitOffset = { limit: number; offset: number };

/**
 * Parse `limit`/`offset` pagination, clamping `limit` to `[1, maxLimit]` and
 * `offset` to `>= 0`. A missing or non-numeric value falls back to the default
 * (unlike a bare `parseInt`, which would yield `NaN`).
 */
export function parseLimitOffset(
  searchParams: URLSearchParams,
  opts: { defaultLimit: number; maxLimit: number },
): LimitOffset {
  const limitRaw = searchParams.get('limit');
  const offsetRaw = searchParams.get('offset');
  const limit = limitRaw
    ? clampInt(Number(limitRaw), 1, opts.maxLimit, opts.defaultLimit)
    : opts.defaultLimit;
  const offset = offsetRaw ? clampInt(Number(offsetRaw), 0, Number.MAX_SAFE_INTEGER, 0) : 0;
  return { limit, offset };
}

/** Read a multipart-form field as a boolean (`"true"` → true, anything else → false). */
export function formBool(form: FormData, key: string): boolean {
  return form.get(key) === 'true';
}

/**
 * Like {@link formBool} but tri-state: returns `undefined` when the field is
 * absent, so a PATCH-style handler can tell "leave unchanged" from "set false".
 */
export function formBoolOptional(form: FormData, key: string): boolean | undefined {
  return form.has(key) ? form.get(key) === 'true' : undefined;
}
