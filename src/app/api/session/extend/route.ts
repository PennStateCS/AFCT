import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { auth } from '@/lib/auth';

/**
 * Records that the signed-in user is still active, resetting the client-side
 * inactivity timer. This is an audit/telemetry ping — the JWT session lifetime
 * is managed by NextAuth and is not altered here.
 * @openapi
 * summary: Keep the current session active
 * responses:
 *   200:
 *     description: Activity recorded.
 *     content:
 *       application/json:
 *         schema:
 *           type: object
 *           properties:
 *             ok: { type: boolean }
 *   401: { description: Not signed in. }
 *   500: { description: Server error. }
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user || session.user.inactive) {
      await createEnhancedActivityLog(prisma, req, {
        action: 'SESSION_EXTENSION_FAILED',
        severity: 'WARNING',
        category: 'SYSTEM',
        metadata: {
          reason: 'Not authenticated',
        },
      });

      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await createEnhancedActivityLog(prisma, req, {
      userId: session.user.id,
      action: 'SESSION_EXTENDED',
      severity: 'INFO',
      category: 'SYSTEM',
      metadata: {
        kind: 'inactivity-reset',
      },
    });

    return NextResponse.json({
      ok: true,
    });
  } catch (err) {
    console.error('Session extend error:', err);

    await createEnhancedActivityLog(prisma, req, {
      action: 'SESSION_EXTENSION_ERROR',
      severity: 'ERROR',
      category: 'SYSTEM',
      metadata: {
        error: err instanceof Error ? err.message : 'Unknown error',
      },
    });

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
