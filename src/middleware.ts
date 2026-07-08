import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

/**
 * Coarse, edge-level authentication net (see `config.matcher`).
 *
 * This is defense-in-depth, NOT the source of truth: every route and page still
 * runs its own authoritative check (route handlers call `auth()` + the permission
 * helpers; the dashboard layout redirects unauthenticated users). Here we only read
 * the signed JWT — no DB, since this runs on the edge — and reject early:
 *
 *  - `/api/admin/*`: positively confirm a NON-admin out with 403. A missing or
 *    undecodable token falls through to the route's authoritative `isAdmin` check,
 *    so a decode hiccup can never lock admins out.
 *  - other matched `/api/*`: require a signed-in session; no token -> 401. Per-course
 *    role/authorization still happens in the handler (the edge can't reach Prisma).
 *  - `/dashboard/*` pages: require a session; no token -> redirect to /login.
 *
 * Public API routes (`/api/auth/*`, `/api/health`, `/api/system-settings/public`,
 * `/api/public/*`) are intentionally NOT matched.
 */
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const token = await getToken({
    req,
    secret: process.env.NEXTAUTH_SECRET,
    secureCookie: process.env.NODE_ENV === 'production',
  });

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
  matcher: [
    // Admin: coarse isAdmin gate.
    '/api/admin/:path*',
    // Dashboard pages: must be signed in.
    '/dashboard/:path*',
    // Authenticated data APIs: must be signed in (authorization stays in the route).
    '/api/courses/:path*',
    '/api/assignments/:path*',
    '/api/problems/:path*',
    '/api/comments/:path*',
    '/api/submissions/:path*',
    '/api/course_submissions/:path*',
    '/api/profile/:path*',
    '/api/users/:path*',
  ],
};
