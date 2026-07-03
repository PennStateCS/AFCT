// /src/app/api/public/login/route.ts

import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcrypt';
import { prisma } from '@/lib/prisma';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email, password } = body || {};

    // Check for missing credentials
    if (!email || !password) {
      console.warn('Login failed: Missing email or password');
      await createEnhancedActivityLog(prisma, req, {
        action: 'LOGIN_FAILED',
        severity: 'SECURITY',
        category: 'SYSTEM',
        metadata: { reason: 'Missing credentials', email: email },
      });

      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });

    if (!user) {
      console.warn(`Login failed for ${normalizedEmail}: Invalid credentials`);
      await createEnhancedActivityLog(prisma, req, {
        action: 'LOGIN_FAILED',
        severity: 'SECURITY',
        category: 'SYSTEM',
        metadata: { reason: 'Invalid credentials', email: normalizedEmail },
      });

      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    const passwordMatches = await bcrypt.compare(password, user.password);
    if (!passwordMatches) {
      console.warn(`Login failed for ${normalizedEmail}: Invalid credentials`);
      await createEnhancedActivityLog(prisma, req, {
        action: 'LOGIN_FAILED',
        severity: 'SECURITY',
        category: 'SYSTEM',
        metadata: { reason: 'Invalid credentials', email: normalizedEmail },
      });

      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    if (user.inactive) {
      console.warn(`Login failed for ${normalizedEmail}: Inactive user`);
      await createEnhancedActivityLog(prisma, req, {
        action: 'LOGIN_FAILED',
        severity: 'SECURITY',
        category: 'SYSTEM',
        metadata: { reason: 'Inactive user', email: normalizedEmail },
      });

      return NextResponse.json({ error: 'Inactive user' }, { status: 401 });
    }

    await createEnhancedActivityLog(prisma, req, {
      userId: user.id,
      action: 'LOGIN_SUCCESS',
      severity: 'INFO',
      category: 'SYSTEM',
      metadata: {
        userId: user.id,
        email: user.email,
        role: user.role,
      },
    });

    return NextResponse.json(
      {
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
        },
      },
      { status: 200 },
    );
  } catch (err) {
    console.error('Login error:', err);

    await createEnhancedActivityLog(prisma, req, {
      action: 'LOGIN_ERROR',
      severity: 'ERROR',
      category: 'SYSTEM',
      metadata: {
        error: err instanceof Error ? err.message : 'Unknown error',
      },
    });

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
