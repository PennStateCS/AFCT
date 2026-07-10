/**
 * Small helpers for pulling typed values out of an incoming request — a validated
 * JSON body, query-param pagination, and multipart-form flags — plus the
 * bounded-integer coercion they build on. Centralizes idioms that had been
 * re-implemented (and occasionally mis-implemented) across route handlers.
 */

import type { NextResponse } from 'next/server';
import type { ZodType } from 'zod';
import { apiError } from './http';

/**
 * Parse and validate a JSON request body against a Zod schema. Returns a discriminated
 * result: `{ ok: true, data }` with the typed, validated body, or `{ ok: false,
 * response }` — a ready-to-return **400** for malformed JSON or a schema mismatch.
 * Never throws, so a handler can `if (!parsed.ok) return parsed.response;` and move on.
 */
export async function readJson<T>(
  req: Request,
  schema: ZodType<T>,
): Promise<{ ok: true; data: T } | { ok: false; response: NextResponse }> {
  let raw: unknown;
  try {
    raw = await req.json();
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
