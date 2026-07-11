import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { isSessionIdleExpired } from '@/lib/session-timeout';
import { requireAuthSecret } from '@/lib/auth-secret';

/**
 * Coarse, edge-level authentication net.
 *
 * This is defense-in-depth, NOT the source of truth: every route and page still runs
 * its own authoritative check (route handlers use `withAdminAuth`/`withCourseAuth` or
 * call `auth()` + the permission helpers; the dashboard layout redirects
 * unauthenticated users). Here we only read the signed JWT — no DB, since this runs on
 * the edge — and reject early.
 *
 * Deny-by-default: the matcher covers ALL of `/api/*` and `/dashboard/*`, and only the
 * small, stable {@link PUBLIC_API_PREFIXES} allowlist is let through unauthenticated.
 * This means a newly added authed API route is gated automatically (fail-closed) — the
 * matcher never needs editing when routes move or are added.
 *
 *  - Public API routes: bypass the net (no token read).
 *  - `/api/admin/*`: positively confirm a NON-admin out with 403. A missing or
 *    undecodable token falls through to the route's authoritative `isAdmin` check, so a
 *    decode hiccup can never lock admins out.
 *  - any other `/api/*`: require a signed-in session; no token -> 401. Per-course
 *    role/authorization still happens in the handler (the edge can't reach Prisma).
 *  - `/dashboard/*` pages: require a session; no token -> redirect to /login.
 */
const PUBLIC_API_PREFIXES = [
  '/api/auth', // NextAuth handler, signup, check-email
  '/api/health',
  '/api/system-settings/public',
] as const;

function isPublicApi(pathname: string): boolean {
  return PUBLIC_API_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Public API routes bypass the net entirely (and skip the token read).
  if (pathname.startsWith('/api/') && isPublicApi(pathname)) {
    return NextResponse.next();
  }

  const token = await getToken({
    req,
    secret: requireAuthSecret(),
    secureCookie: process.env.NODE_ENV === 'production',
  });

  // Idle-timeout backstop: reject a signed-in token whose activity window has
  // lapsed, from the token alone (no DB — this runs on the edge). The client
  // watcher normally signs the user out gracefully first; this catches clients
  // that aren't running (locked, suspended, JS disabled, tampered). Sign-out and
  // the activity heartbeat go through `/api/auth/*`, which is allowlisted above,
  // so an expired session can still end itself.
  if (token && isSessionIdleExpired(token.lastActivity, token.idleTimeoutMs, Date.now())) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const loginUrl = new URL('/login', req.url);
    loginUrl.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Admin namespace: only short-circuit when we can POSITIVELY confirm a non-admin.
  if (pathname.startsWith('/api/admin')) {
    if (token && token.isAdmin !== true) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    return NextResponse.next();
  }

  // Everything else the matcher covers requires a signed-in session.
  if (!token) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    // Page route: bounce to login, remembering where they were headed.
    const loginUrl = new URL('/login', req.url);
    loginUrl.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/api/:path*', '/dashboard/:path*'],
};
