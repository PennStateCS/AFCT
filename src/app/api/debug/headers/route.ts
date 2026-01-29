import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  // Debug: log all headers
  const headers: Record<string, string> = {};
  req.headers.forEach((value: string, key: string) => {
    headers[key] = value;
  });

  const debugInfo = {
    url: req.url,
    method: req.method,
    headers,
    nextUrl: {
      pathname: req.nextUrl.pathname,
      search: req.nextUrl.search,
      host: req.nextUrl.host,
      hostname: req.nextUrl.hostname,
      port: req.nextUrl.port,
      protocol: req.nextUrl.protocol,
    },
    // Note: req.geo and req.ip are not available in Next.js App Router
  };

  // debug info available in debugInfo

  return NextResponse.json(debugInfo);
}
