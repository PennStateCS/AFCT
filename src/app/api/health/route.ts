import { NextResponse } from 'next/server';

/**
 * Lightweight liveness check used by the container healthcheck. No auth, no DB.
 *
 * Intentionally minimal: this endpoint is unauthenticated, so it returns only a
 * liveness signal — no environment or version, which would give an anonymous
 * caller free recon. Host/version/build detail lives behind the admin-only
 * status routes (`/api/admin/status/*`).
 * @openapi
 * responses:
 *   200:
 *     description: Service is healthy.
 *     content:
 *       application/json:
 *         schema:
 *           type: object
 *           properties:
 *             status: { type: string, example: ok }
 *             timestamp: { type: string, format: date-time }
 *             uptime: { type: number }
 *   503:
 *     description: Health check failed.
 */
export async function GET() {
  try {
    const health = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    };

    return NextResponse.json(health, { status: 200 });
  } catch {
    return NextResponse.json(
      { 
        status: 'error', 
        message: 'Health check failed',
        timestamp: new Date().toISOString()
      }, 
      { status: 503 }
    );
  }
}
