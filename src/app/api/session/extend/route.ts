// /src/app/api/session/extend/route.ts

import { getToken } from 'next-auth/jwt';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';

export async function POST(req: NextRequest) {
  try {
    // Extract token from the request using the NEXTAUTH secret
    const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });

    // If no token is found, the user is not authenticated
    if (!token) {
      console.warn('Session extension failed: no token present');

      await createEnhancedActivityLog(prisma, req, {
        action: 'SESSION_EXTENSION_FAILED',
        category: 'SYSTEM',
        metadata: {
          reason: 'No token found',
        },
      });

      return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401 });
    }

    // Log user action: client-side inactivity timer reset requested
    await createEnhancedActivityLog(prisma, req, {
      userId: token.sub,
      action: 'SESSION_EXTENDED',
      category: 'SYSTEM',
      metadata: {
        kind: 'inactivity-reset',
      },
    });

    // JWT expiration is controlled by Auth.js; this endpoint confirms reset intent.
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
