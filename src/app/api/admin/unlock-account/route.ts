import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { logError } from '@/lib/api/activity';
import { withAdminAuth } from '@/lib/api/with-auth';
import { readJson } from '@/lib/api/request';

const UnlockAccountBody = z.object({
  userId: z.string().min(1),
});

/**
 * Clears an account's auto-expiring login lock ahead of its expiry, so a user locked
 * out by failed attempts can sign in again immediately. System administrators only.
 * Idempotent: clearing an already-unlocked account is a no-op success.
 *
 * This only lifts the login gate; it does not reset the in-memory rate-limiter counters
 * for the current instance, so a fresh burst of bad passwords can re-lock the account.
 * That is intentional - the durable lock is the thing an admin manages.
 * @openapi
 * summary: Unlock a locked-out account (admin)
 * requestBody:
 *   required: true
 *   content:
 *     application/json:
 *       schema:
 *         type: object
 *         required: [userId]
 *         properties:
 *           userId: { type: string, description: The user to unlock }
 * responses:
 *   200:
 *     description: Account unlocked (or already unlocked).
 *     content:
 *       application/json:
 *         schema: { type: object, properties: { success: { type: boolean }, wasLocked: { type: boolean } } }
 *   400: { description: Missing userId. }
 *   403: { description: Caller is not a system administrator. }
 *   404: { description: Target user not found. }
 *   500: { description: Unlock failed. }
 */
export const POST = withAdminAuth(
  async (req, _ctx, { user }) => {
    const parsed = await readJson(req, UnlockAccountBody);
    if (!parsed.ok) return parsed.response;
    const { userId } = parsed.data;

    try {
      const target = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, lockedUntil: true },
      });
      if (!target) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
      }

      const wasLocked = Boolean(
        target.lockedUntil && target.lockedUntil.getTime() > Date.now(),
      );

      // Always clear, even if already expired, so the column doesn't carry stale values.
      await prisma.user.update({
        where: { id: userId },
        data: { lockedUntil: null },
      });

      await createEnhancedActivityLog(prisma, req, {
        userId: user.id,
        action: 'UNLOCK_ACCOUNT',
        severity: 'INFO',
        category: 'USER',
        metadata: { targetUserId: userId, wasLocked },
      });

      return NextResponse.json({ success: true, wasLocked });
    } catch (error) {
      console.error('Unlock account error:', error);
      await logError(req, {
        userId: user.id,
        action: 'ADMIN_UNLOCK_ACCOUNT_ERROR',
        category: 'USER',
        error,
      });
      return NextResponse.json({ error: 'Failed to unlock account' }, { status: 500 });
    }
  },
  { deniedAction: 'ADMIN_UNLOCK_ACCOUNT_DENIED' },
);
