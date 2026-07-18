import type { NextResponse } from 'next/server';
import type { Session } from 'next-auth';
import type { CourseRole } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import {
  isAdmin,
  canManageCourse,
  canAccessCourse,
  isCourseArchived,
  isCourseDeleted,
} from '@/lib/permissions';
import { createEnhancedActivityLog, type ActivityCategory } from '@/lib/activity-log-utils';
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
 * This is the authoritative check; `src/proxy.ts` is only a coarse edge-level
 * backstop over `/api/admin/*`.
 */
export function withAdminAuth<Ctx = unknown, R extends Response = Response>(
  handler: (req: Request, ctx: Ctx, auth: AdminAuthContext) => Promise<R> | R,
  opts: { deniedAction: string; deniedCategory?: ActivityCategory },
): (req: Request, ctx: Ctx) => Promise<R | NextResponse> {
  return async (req: Request, ctx: Ctx) => {
    const session = await auth();
    // Reject a missing session or a disabled/deleted account (the session callback
    // marks the user inactive when the DB row is gone or disabled) before any
    // privilege check; a stale JWT must not keep granting admin access.
    if (!session?.user || session.user.inactive) {
      return apiError(401, 'Unauthorized');
    }
    if (!isAdmin(session.user)) {
      await createEnhancedActivityLog(prisma, req, {
        userId: session.user.id,
        action: opts.deniedAction,
        severity: 'SECURITY',
        // Admin-gate denials are system-level unless the caller says otherwise.
        category: opts.deniedCategory ?? 'SYSTEM',
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
 *
 * `blockWhenArchived: true` rejects the action with **409** when the course is
 * archived, **for everyone, admins included** (the archive freeze is not bypassed by
 * the admin short-circuit). Set it on every mutating course route *except* un-archive.
 */
export function withCourseAuth<Ctx extends CourseParams, R extends Response = Response>(
  handler: (req: Request, ctx: Ctx, auth: CourseAuthContext) => Promise<R> | R,
  opts: {
    access: 'manage' | 'read';
    deniedAction: string;
    deniedCategory?: ActivityCategory;
    roles?: CourseRole[];
    param?: string;
    blockWhenArchived?: boolean;
  },
): (req: Request, ctx: Ctx) => Promise<R | NextResponse> {
  return async (req: Request, ctx: Ctx) => {
    const session = await auth();
    // Reject a missing session or a disabled/deleted account before any course
    // check (see withAdminAuth); a stale JWT must not keep granting access.
    if (!session?.user || session.user.inactive) {
      return apiError(401, 'Unauthorized');
    }

    const params = await ctx.params;
    const courseId = params?.[opts.param ?? 'id'];
    if (!courseId) {
      return apiError(400, 'Missing course id');
    }

    // A soft-deleted course is inaccessible to everyone (admins included) since it's
    // retained only for out-of-band recovery. Mask it as 404 before the role gate so
    // its existence and data are never served through any course-scoped route (this
    // is the choke point the admin short-circuit in canAccessCourse would otherwise
    // slip past). Best-effort: if the lookup itself errors, fall through and let the
    // handler surface that error rather than masking a real fault as a 404.
    try {
      if (await isCourseDeleted(courseId)) {
        return apiError(404, 'Not found');
      }
    } catch {
      // Ignore; proceed to the normal flow; the handler will hit (and report) any
      // real DB fault.
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
        // Course-gate denials are course-level unless the caller says otherwise.
        category: opts.deniedCategory ?? 'COURSE',
        courseId,
        metadata: {},
      });
      return apiError(403, 'Forbidden');
    }

    // Archive freeze: an archived course is read-only for everyone (admins too). This
    // runs *after* the role gate, unconditionally, so the admin short-circuit above
    // cannot slip a write past it.
    if (opts.blockWhenArchived && (await isCourseArchived(courseId))) {
      return apiError(409, 'Course is archived and cannot be modified');
    }

    return withServerTiming(req, () =>
      handler(req, ctx, { session, user: session.user, courseId }),
    );
  };
}

/** The assignment slice resolved and handed to a {@link withAssignmentAuth} handler. */
export type ResolvedAssignment = {
  id: string;
  courseId: string;
  isPublished: boolean;
};

export type AssignmentAuthContext = CourseAuthContext & { assignment: ResolvedAssignment };

/**
 * Course-scoped wrapper that also resolves an **assignment** and enforces the
 * assignment-level rules in one place:
 *   - the assignment must exist **and belong to the resolved course** (else 404);
 *   - for `access: 'read'`, a non-staff caller may only reach a **published**
 *     assignment: an unpublished one is masked as **404** (hide existence), matching
 *     the course publish gate for students.
 *
 * Builds on {@link withCourseAuth} (same 401 / 403+SECURITY / archive behavior). The
 * course id comes from `courseParam` (default `id`), the assignment id from
 * `assignmentParam` (default `aid`). The handler receives `{ …, assignment }`.
 */
export function withAssignmentAuth<Ctx extends CourseParams, R extends Response = Response>(
  handler: (req: Request, ctx: Ctx, auth: AssignmentAuthContext) => Promise<R> | R,
  opts: {
    access: 'manage' | 'read';
    deniedAction: string;
    roles?: CourseRole[];
    courseParam?: string;
    assignmentParam?: string;
    blockWhenArchived?: boolean;
  },
): (req: Request, ctx: Ctx) => Promise<R | NextResponse> {
  return withCourseAuth<Ctx, R | NextResponse>(
    async (req, ctx, courseAuth) => {
      const params = await ctx.params;
      const assignmentId = params?.[opts.assignmentParam ?? 'aid'];
      if (!assignmentId) {
        return apiError(400, 'Missing assignment id');
      }

      const assignment = await prisma.assignment.findFirst({
        where: { id: assignmentId, courseId: courseAuth.courseId },
        select: { id: true, courseId: true, isPublished: true },
      });

      // Not found, or not in this course → 404 (never leak that it exists elsewhere).
      if (!assignment) {
        return apiError(404, 'Not found');
      }

      // Student publish gate: a non-staff reader may only see a published assignment;
      // otherwise mask as 404. (Staff/admin, canManageCourse, see drafts.)
      if (opts.access === 'read' && !assignment.isPublished) {
        const isStaff = await canManageCourse(courseAuth.user, courseAuth.courseId, opts.roles);
        if (!isStaff) {
          return apiError(404, 'Not found');
        }
      }

      return handler(req, ctx, { ...courseAuth, assignment });
    },
    {
      access: opts.access,
      deniedAction: opts.deniedAction,
      roles: opts.roles,
      param: opts.courseParam,
      blockWhenArchived: opts.blockWhenArchived,
    },
  ) as (req: Request, ctx: Ctx) => Promise<R | NextResponse>;
}
