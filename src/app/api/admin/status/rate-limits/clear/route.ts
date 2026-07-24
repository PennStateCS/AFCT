import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { logError } from '@/lib/api/activity';
import { withAdminAuth } from '@/lib/api/with-auth';
import { readJson } from '@/lib/api/request';
import { RATE_LIMIT_SCOPES, clearRestrictedIp } from '@/lib/security/rate-limiter';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ClearRateLimitBody = z.object({
  scope: z.enum(RATE_LIMIT_SCOPES),
  ip: z.string().trim().min(1).max(200),
});

/**
 * Lifts one IP's rate-limit restriction ahead of its expiry, so an administrator can
 * let a locked-out classroom or office back in without waiting it out. System
 * administrators only.
 *
 * Not idempotent by design: clearing an address that is not currently restricted
 * returns 404 rather than a silent success, so the caller learns the restriction had
 * already lapsed (or landed on another instance) instead of assuming it acted.
 * @openapi
 * summary: Clear one IP address's rate limit (admin)
 * requestBody:
 *   required: true
 *   content:
 *     application/json:
 *       schema:
 *         type: object
 *         required: [scope, ip]
 *         properties:
 *           scope: { type: string, enum: [login:ip, signup:ip, check-email:ip], description: Which limit to clear }
 *           ip: { type: string, description: The restricted address }
 * responses:
 *   200:
 *     description: The restriction was cleared.
 *     content:
 *       application/json:
 *         schema: { type: object, properties: { success: { type: boolean } } }
 *   400: { description: Missing or invalid scope/ip. }
 *   403: { description: Caller is not a system administrator. }
 *   404: { description: That address is not currently restricted. }
 *   500: { description: Clearing the restriction failed. }
 */
export const POST = withAdminAuth(
  async (req, _ctx, { user }) => {
    const parsed = await readJson(req, ClearRateLimitBody);
    if (!parsed.ok) return parsed.response;
    const { scope, ip } = parsed.data;

    try {
      const cleared = clearRestrictedIp({ scope, ip });
      if (!cleared) {
        return NextResponse.json(
          { error: 'That address is not currently rate limited' },
          { status: 404 },
        );
      }

      // Lifting a protection is an access-control change, so it is logged at SECURITY
      // severity with the actor, the address, and what was in force when it was cleared.
      await createEnhancedActivityLog(prisma, req, {
        userId: user.id,
        action: 'CLEAR_RATE_LIMIT',
        severity: 'SECURITY',
        category: 'SYSTEM',
        metadata: {
          targetIp: cleared.ip,
          scope: cleared.scope,
          state: cleared.state,
          reason: cleared.reason,
          startedAt: new Date(cleared.startedAt).toISOString(),
          wouldHaveExpiredAt: new Date(cleared.expiresAt).toISOString(),
          attempts: cleared.attempts,
          attemptsWhileRestricted: cleared.attemptsWhileRestricted,
        },
      });

      return NextResponse.json({ success: true });
    } catch (error) {
      console.error('Clear rate limit error:', error);
      await logError(req, {
        userId: user.id,
        action: 'ADMIN_CLEAR_RATE_LIMIT_ERROR',
        category: 'SYSTEM',
        error,
      });
      return NextResponse.json({ error: 'Failed to clear the rate limit' }, { status: 500 });
    }
  },
  { deniedAction: 'ADMIN_CLEAR_RATE_LIMIT_DENIED' },
);
