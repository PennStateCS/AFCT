// middleware.ts
import { NextResponse, type NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

export async function middleware(req: NextRequest) {
  const token = await getToken({ req });
  const pathname = req.nextUrl.pathname;

  const isAuth = !!token;

  // Redirect unauthenticated users to /login
  if (!isAuth && pathname !== '/login') {
    return NextResponse.redirect(new URL('/login', req.url));
  }

  // Extract IP and User-Agent
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0] || req.ip || 'unknown';
  const userAgent = req.headers.get('user-agent') || 'unknown';

  // Forward IP and User-Agent to auth callbacks via headers
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-user-ip', ip);
  requestHeaders.set('x-user-agent', userAgent);

  return NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
}

export const config = {
  matcher: ['/dashboard/:path*', '/admin/:path*'],
};
