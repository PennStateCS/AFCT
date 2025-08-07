// /src/app/api/session/extend/route.ts

import { getToken } from 'next-auth/jwt';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const EXTEND_BY = 15 * 60; // Extend session by 15 minutes (in seconds)

// Extract IP address from headers or fallback
function getClientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return (req as any).ip || 'unknown';
}

export async function POST(req: Request) {
  const ip = getClientIp(req);

  try {
    // Extract token from the request using the NEXTAUTH secret
    const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });

    // If no token is found, the user is not authenticated
    if (!token) {
      console.warn('Session extension failed: no token present');

      await prisma.activityLog.create({
        data: {
          userId: null,
          action: 'SESSION_EXTENSION_FAILED',
          metadata: {
            reason: 'No token found',
            ipAddress: ip,
          },
        },
      });

      return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401 });
    }

    // Calculate new expiration time
    const now = Math.floor(Date.now() / 1000);
    const newExpiry = now + EXTEND_BY;

    // Log session extension to ActivityLog
    await prisma.activityLog.create({
      data: {
        userId: token.sub,
        action: 'SESSION_EXTENDED',
        metadata: {
          ipAddress: ip,
          extendedBy: `${EXTEND_BY} seconds`,
          newExpiry: new Date(newExpiry * 1000).toISOString(),
        },
      },
    });

    // Respond with new expiration time
    return NextResponse.json({
      ok: true,
      expires: new Date(newExpiry * 1000).toISOString(),
    });
  } catch (err) {
    console.error('Session extend error:', err);

    await prisma.activityLog.create({
      data: {
        userId: null,
        action: 'SESSION_EXTENSION_ERROR',
        metadata: {
          error: err instanceof Error ? err.message : 'Unknown error',
          ipAddress: ip,
        },
      },
    });

    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}
