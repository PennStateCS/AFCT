import type { NextResponse } from 'next/server';
import type { Session } from 'next-auth';
import type { CourseRole } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { isAdmin, canManageCourse, canAccessCourse } from '@/lib/permissions';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { withServerTiming } from '@/lib/perf-debug';
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
    return withServerTiming(req, () => handler(req, ctx, { session, user: session.user }));
  };
}

export type CourseAuthContext = {
  session: Session;
  user: SessionUser;
  /** The course the request is scoped to (resolved before the handler runs). */
  courseId: string;
};

type CourseParams = { params: Promise<Record<string, string>> };

/**
 * Wraps a course-scoped route handler with the shared gate, following the same
 * app-wide standard as {@link withAdminAuth}:
 *   - no signed-in session       -> 401 `{ error: 'Unauthorized' }` (not logged)
 *   - insufficient course role    -> 403 `{ error: 'Forbidden' }` + a SECURITY
 *                                    `deniedAction` audit event (scoped to the course)
 *
 * `access: 'manage'` requires course staff (FACULTY/TA by default; pass `roles` to
 * narrow, e.g. `['FACULTY']`); `access: 'read'` requires any enrolled member. Admins
 * pass both. The course id is read from the route param named `param` (default `id`).
 * The handler receives the resolved `{ session, user, courseId }`; it can still await
 * `ctx.params` for other params (e.g. `aid`).
 */
export function withCourseAuth<Ctx extends CourseParams, R extends Response = Response>(
  handler: (req: Request, ctx: Ctx, auth: CourseAuthContext) => Promise<R> | R,
  opts: {
    access: 'manage' | 'read';
    deniedAction: string;
    roles?: CourseRole[];
    param?: string;
  },
): (req: Request, ctx: Ctx) => Promise<R | NextResponse> {
  return async (req: Request, ctx: Ctx) => {
    const session = await auth();
    if (!session?.user) {
      return apiError(401, 'Unauthorized');
    }

    const params = await ctx.params;
    const courseId = params?.[opts.param ?? 'id'];
    if (!courseId) {
      return apiError(400, 'Missing course id');
    }

    const allowed =
      opts.access === 'manage'
        ? await canManageCourse(session.user, courseId, opts.roles)
        : await canAccessCourse(session.user, courseId);

    if (!allowed) {
      await createEnhancedActivityLog(prisma, req, {
        userId: session.user.id,
        action: opts.deniedAction,
        severity: 'SECURITY',
        courseId,
        metadata: {},
      });
      return apiError(403, 'Forbidden');
    }

    return withServerTiming(req, () =>
      handler(req, ctx, { session, user: session.user, courseId }),
    );
  };
}
