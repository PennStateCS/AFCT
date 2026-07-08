import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

/**
 * Coarse admin gate for the `/api/admin/*` namespace (see `config.matcher`).
 *
 * This is defense-in-depth, NOT the source of truth: every admin route still
 * calls `isAdmin(session.user)` with a fresh DB read. Here we only read the
 * signed JWT (no DB — this runs on the edge) and short-circuit with 403 when we
 * can POSITIVELY confirm a non-admin caller. If the token is missing or can't be
 * decoded, we fall through to the route, which enforces auth authoritatively —
 * so a decode hiccup can never lock admins out.
 */
export async function middleware(req: NextRequest) {
  const token = await getToken({
    req,
    secret: process.env.NEXTAUTH_SECRET,
    secureCookie: process.env.NODE_ENV === 'production',
  });

  if (token && token.isAdmin !== true) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/api/admin/:path*'],
};
