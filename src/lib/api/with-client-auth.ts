// src/lib/api/with-client-auth.ts
import type { NextResponse } from 'next/server';
import { resolveClientToken, type ClientTokenUser } from '@/lib/client-auth';
import { apiError } from './http';

/** What a native-client handler receives once token auth has passed. */
export type ClientAuthContext = {
  /** The token's owner. Shaped to compose with the permission helpers. */
  user: ClientTokenUser;
  /** The id of the ClientApiToken used (for logout/revoke). */
  tokenId: string;
};

/** Pull the raw token out of an `Authorization: Bearer <token>` header. */
function extractBearer(req: Request): string | null {
  const header = req.headers.get('authorization');
  if (!header) return null;
  const token = /^Bearer\s+(.+)$/i.exec(header.trim())?.[1];
  return token ? token.trim() : null;
}

/**
 * Wraps a native-client route handler. Authenticates via `Authorization: Bearer
 * <token>` (a `ClientApiToken`), NOT the browser session cookie — so there's no CSRF
 * and no browser idle-timeout. Returns **401** for a missing, malformed, unknown,
 * expired, or revoked token (or an inactive user). The handler runs only for a valid
 * token and receives `{ user, tokenId }`; per-course authorization
 * (`canAccessCourse`/`canManageCourse` with `ctx.user`) still runs inside.
 *
 * `/api/client/*` is allowlisted in `src/proxy.ts`, so this wrapper is the
 * authoritative auth for client routes (the edge net doesn't cover them).
 */
export function withClientAuth<Ctx = unknown, R extends Response = Response>(
  handler: (req: Request, ctx: Ctx, auth: ClientAuthContext) => Promise<R> | R,
): (req: Request, ctx: Ctx) => Promise<R | NextResponse> {
  return async (req: Request, ctx: Ctx) => {
    const raw = extractBearer(req);
    if (!raw) return apiError(401, 'Unauthorized');
    const resolved = await resolveClientToken(raw);
    if (!resolved) return apiError(401, 'Unauthorized');
    return handler(req, ctx, { user: resolved.user, tokenId: resolved.tokenId });
  };
}
