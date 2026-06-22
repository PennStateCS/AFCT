// /src/app/api/session/extend/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { auth } from '@/lib/auth';

export async function POST(req: NextRequest) {
  try {
    // Verify
    const session = await auth();

    if (!session || !session.user) {
      await createEnhancedActivityLog(prisma, req, {
        action: 'SESSION_EXTENSION_FAILED',
        category: 'SYSTEM',
        metadata: {
          reason: 'Not authenticated',
        },
      });

      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Log user action: client-side inactivity timer reset requested
    await createEnhancedActivityLog(prisma, req, {
      userId: session.user.id,
      action: 'SESSION_EXTENDED',
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
      category: 'SYSTEM',
      metadata: {
        error: err instanceof Error ? err.message : 'Unknown error',
      },
    });

    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}
