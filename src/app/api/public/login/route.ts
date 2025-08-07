// /src/app/api/public/login/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { authenticateUser } from '@/app/services/authService';
import { prisma } from '@/lib/prisma';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email, password } = body || {};

    // Check for missing credentials
    if (!email || !password) {
      console.warn('Login failed: Missing email or password');
      await prisma.activityLog.create({
        data: {
          userId: null,
          action: 'LOGIN_FAILED',
          metadata: { reason: 'Missing credentials', email },
        },
      });

      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
    }

    // Authenticate user (returns token and user info on success)
    const auth = await authenticateUser(email, password);

    // If authentication fails, log and return 401
    if (!auth) {
      console.warn(`Login failed for ${email}: Invalid credentials`);
      await prisma.activityLog.create({
        data: {
          userId: null,
          action: 'LOGIN_FAILED',
          metadata: { reason: 'Invalid credentials', email },
        },
      });

      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    // Log successful login
    await prisma.activityLog.create({
      data: {
        userId: auth.user.id,
        action: 'LOGIN_SUCCESS',
        metadata: {
          email: auth.user.email,
          role: auth.user.role,
        },
      },
    });

    // Return token and user info
    return NextResponse.json(
      {
        token: auth.token,
        user: {
          id: auth.user.id,
          email: auth.user.email,
          firstName: auth.user.firstName,
          lastName: auth.user.lastName,
          role: auth.user.role,
        },
      },
      { status: 200 },
    );
  } catch (err) {
    console.error('Login error:', err);

    // Log unexpected error
    await prisma.activityLog.create({
      data: {
        userId: null,
        action: 'LOGIN_ERROR',
        metadata: {
          error: err instanceof Error ? err.message : 'Unknown error',
        },
      },
    });

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
