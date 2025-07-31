import { getToken } from 'next-auth/jwt';
import { NextResponse } from 'next/server';

const EXTEND_BY = 15 * 60; // 15 minutes

export async function POST(req: Request) {
  try {
    const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });

    if (!token) {
      return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401 });
    }

    const now = Math.floor(Date.now() / 1000);
    const newExpiry = now + EXTEND_BY;

    // We can't modify the token server-side without a custom callback, so we signal the client
    return NextResponse.json({
      ok: true,
      expires: new Date(newExpiry * 1000).toISOString(),
    });
  } catch (err) {
    console.error('Session extend error:', err);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}
