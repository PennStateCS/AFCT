import type { NextResponse } from 'next/server';
import type { Session } from 'next-auth';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { isAdmin } from '@/lib/permissions';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { apiError } from './http';

/** The session user shape handlers receive once auth has passed. */
export type SessionUser = Session['user'];

export type AdminAuthContext = {
  session: Session;
  user: SessionUser;
};

/**
 * Wraps a system-admin route handler with the shared gate: resolve the session,
 * require `isAdmin`, and on failure record an optional SECURITY denial and return
 * 403. The handler runs only for a confirmed admin and receives the resolved
 * session/user so it needn't call `auth()` again.
 *
 * This is the authoritative check; `src/middleware.ts` is only a coarse edge-level
 * backstop over `/api/admin/*`. Behavior matches what every admin route did by hand
 * (403 with `{ error: 'Unauthorized' }`); pass `deniedAction` for the routes that
 * additionally logged a `*_DENIED` audit event.
 */
export function withAdminAuth<Ctx = unknown, R extends Response = Response>(
  handler: (req: Request, ctx: Ctx, auth: AdminAuthContext) => Promise<R> | R,
  opts: { deniedAction?: string } = {},
): (req: Request, ctx: Ctx) => Promise<R | NextResponse> {
  return async (req: Request, ctx: Ctx) => {
    const session = await auth();
    if (!session?.user || !isAdmin(session.user)) {
      if (opts.deniedAction) {
        await createEnhancedActivityLog(prisma, req, {
          userId: session?.user?.id ?? null,
          action: opts.deniedAction,
          severity: 'SECURITY',
          metadata: {},
        });
      }
      return apiError(403, 'Unauthorized');
    }
    return handler(req, ctx, { session, user: session.user });
  };
}
