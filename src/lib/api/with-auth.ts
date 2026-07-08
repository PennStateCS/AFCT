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
 * Wraps a system-admin route handler with the shared gate, following the app-wide
 * auth-response standard:
 *   - no signed-in session            -> 401 `{ error: 'Unauthorized' }` (not logged;
 *                                        unauthenticated hits are unattributable noise)
 *   - signed in but not an admin      -> 403 `{ error: 'Forbidden' }` + a SECURITY
 *                                        `deniedAction` audit event (a known user
 *                                        exceeding their permissions is worth a trail)
 * The handler runs only for a confirmed admin and receives the resolved session/user
 * so it needn't call `auth()` again.
 *
 * This is the authoritative check; `src/middleware.ts` is only a coarse edge-level
 * backstop over `/api/admin/*`.
 */
export function withAdminAuth<Ctx = unknown, R extends Response = Response>(
  handler: (req: Request, ctx: Ctx, auth: AdminAuthContext) => Promise<R> | R,
  opts: { deniedAction: string },
): (req: Request, ctx: Ctx) => Promise<R | NextResponse> {
  return async (req: Request, ctx: Ctx) => {
    const session = await auth();
    if (!session?.user) {
      return apiError(401, 'Unauthorized');
    }
    if (!isAdmin(session.user)) {
      await createEnhancedActivityLog(prisma, req, {
        userId: session.user.id,
        action: opts.deniedAction,
        severity: 'SECURITY',
        metadata: {},
      });
      return apiError(403, 'Forbidden');
    }
    return handler(req, ctx, { session, user: session.user });
  };
}
