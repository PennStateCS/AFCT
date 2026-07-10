import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcrypt';
import { prisma } from '@/lib/prisma';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { logError } from '@/lib/api/activity';
import { normalizeEmail } from '@/lib/email';

/**
 * Verifies email/password credentials and returns the matching user's public
 * profile. This only checks credentials and records the attempt in the audit
 * log — it does not establish a session (NextAuth owns the session cookie).
 * Every failure path returns the same generic "Invalid credentials" to avoid
 * revealing which part was wrong.
 * @openapi
 * summary: Verify login credentials
 * requestBody:
 *   required: true
 *   content:
 *     application/json:
 *       schema:
 *         type: object
 *         required: [email, password]
 *         properties:
 *           email: { type: string }
 *           password: { type: string }
 * responses:
 *   200:
 *     description: Credentials are valid; returns the user's public fields.
 *     content:
 *       application/json:
 *         schema:
 *           type: object
 *           properties:
 *             user:
 *               type: object
 *               properties:
 *                 id: { type: string }
 *                 email: { type: string }
 *                 firstName: { type: string }
 *                 lastName: { type: string }
 *   400: { description: Email or password missing. }
 *   401: { description: "Invalid credentials, or the account is inactive." }
 *   500: { description: Server error. }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email, password } = body || {};

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

    const normalizedEmail = normalizeEmail(email);
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
      },
    });

    return NextResponse.json(
      {
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
        },
      },
      { status: 200 },
    );
  } catch (err) {
    console.error('Login error:', err);

    await logError(req, {
      action: 'LOGIN_ERROR',
      error: err,
      category: 'SYSTEM',
    });

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
