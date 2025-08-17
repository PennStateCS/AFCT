import { NextResponse, type NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/admin/:path*',
    '/api/:path*', // includes /api/auth/*
  ],
};

export async function middleware(req: NextRequest) {
  const token = await getToken({ 
    req, 
    secret: process.env.NEXTAUTH_SECRET 
  });
  const pathname = req.nextUrl.pathname;

  // IP/User-Agent extraction (no req.ip!)
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0] || req.headers.get('x-real-ip') || 'unknown';
  const userAgent = req.headers.get('user-agent') || 'unknown';

  // Clone headers to add our own
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-user-ip', ip);
  requestHeaders.set('x-user-agent', userAgent);

  // Never block/redirect API routes (including NextAuth)
  if (pathname.startsWith('/api/')) {
    return NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    });
  }

  // For dashboard/admin: redirect to login if unauthenticated
  if (!token && pathname !== '/login') {
    return NextResponse.redirect(new URL('/login', req.url));
  }

  // Default: allow, with enriched headers
  return NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
}
