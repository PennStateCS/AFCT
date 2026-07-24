import { NextResponse } from 'next/server';
import { withAdminAuth } from '@/lib/api/with-auth';
import { listRestrictedIps } from '@/lib/security/rate-limiter';
import type { RateLimitsStatusResponse } from '@/lib/status/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Rate Limits tab: every client IP currently blocked or under a captcha-challenge
 * cooldown, with why it was restricted, since when, how hard it is still knocking,
 * and when the restriction lifts on its own.
 *
 * The rate limiter keeps its buckets in process memory, so this reports the state of
 * the instance that serves the request and resets when the app restarts. It exposes
 * visitors' IP addresses, so system administrators only.
 * @openapi
 * summary: Currently rate-limited IP addresses
 * responses:
 *   200: { description: The IP addresses currently restricted on this instance. }
 *   401: { description: Not signed in. }
 *   403: { description: Not a system administrator. }
 */
export const GET = withAdminAuth(
  async () => {
    const body: RateLimitsStatusResponse = {
      entries: listRestrictedIps(),
      generatedAt: Date.now(),
    };
    return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
  },
  { deniedAction: 'ADMIN_STATUS_ACCESS_DENIED' },
);
