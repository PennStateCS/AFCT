// middleware.ts
import { getToken } from 'next-auth/jwt';
import { NextResponse, type NextRequest } from 'next/server';

export async function middleware(req: NextRequest) {
  const token = await getToken({ req });
  const url = req.nextUrl;
  const pathname = url.pathname;

  const isAuth = !!token;

  // Allow only authenticated users to access protected routes
  if (!isAuth && pathname !== '/login') {
    return NextResponse.redirect(new URL('/login', req.url));
  }

  // All authenticated users are allowed to access /dashboard
  // No special logic needed for role checking

  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*', '/admin/:path*'], // use only if you plan to protect /admin
};
