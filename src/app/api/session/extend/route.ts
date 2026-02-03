// /src/app/api/session/extend/route.ts

import { getToken } from 'next-auth/jwt';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';

const EXTEND_BY = 15 * 60; // Extend session by 15 minutes (in seconds)

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

    // Calculate new expiration time
    const now = Math.floor(Date.now() / 1000);
    const newExpiry = now + EXTEND_BY;

    // Log session extension to ActivityLog
    await createEnhancedActivityLog(prisma, req, {
      userId: token.sub,
      action: 'SESSION_EXTENDED',
      category: 'SYSTEM',
      metadata: {
        extendedBy: `${EXTEND_BY} seconds`,
        newExpiry: new Date(newExpiry * 1000).toISOString(),
      },
    });

    // Respond with new expiration time
    return NextResponse.json({
      ok: true,
      expires: new Date(newExpiry * 1000).toISOString(),
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
