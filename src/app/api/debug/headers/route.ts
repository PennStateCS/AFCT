import { NextRequest, NextResponse } from 'next/server';

/**
 * Echoes the incoming request's headers and parsed URL back to the caller. A
 * diagnostic aid for verifying what reaches the app behind a proxy (host,
 * forwarded headers, protocol). Unauthenticated — it reflects only the caller's
 * own request, but consider removing it from production.
 * @openapi
 * summary: Echo request headers (debug)
 * responses:
 *   200:
 *     description: The request's method, URL, headers, and parsed nextUrl.
 *     content:
 *       application/json:
 *         schema:
 *           type: object
 *           properties:
 *             url: { type: string }
 *             method: { type: string }
 *             headers: { type: object, additionalProperties: { type: string } }
 *             nextUrl: { type: object }
 */
export async function GET(req: NextRequest) {
  const headers: Record<string, string> = {};
  req.headers.forEach((value: string, key: string) => {
    headers[key] = value;
  });

  return NextResponse.json({
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
    // req.geo and req.ip aren't available in the App Router runtime.
  });
}
