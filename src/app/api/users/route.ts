import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcrypt';
import { auth } from '@/lib/auth';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { COMMON_TIMEZONES } from '@/lib/timezones';
import { getUsersList } from '@/lib/users-list';
import { isAdmin } from '@/lib/permissions';

const isValidEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

// Local password check for admin-created accounts: 8+ chars with mixed case, a
// digit, and a symbol.
const isStrongPassword = (pw: string) =>
  pw.length >= 8 &&
  /[A-Z]/.test(pw) &&
  /[a-z]/.test(pw) &&
  /\d/.test(pw) &&
  /[^A-Za-z0-9]/.test(pw);

/**
 * Lists users for the staff-facing users table, optionally filtered to one role.
 * Restricted to ADMIN/FACULTY/TA; the access itself is audited.
 * @openapi
 * summary: List users
 * responses:
 *   200:
 *     description: Users (optionally filtered by role).
 *     content:
 *       application/json:
 *         schema: { type: array, items: { type: object } }
 *   403: { description: Caller lacks a staff role. }
 *   500: { description: Server error. }
 */
export async function GET(req: Request) {
  try {
    const session = await auth();
    if (!session?.user || !isAdmin(session.user)) {
      console.warn('[USERS_GET] Unauthorized access attempt');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const users = await getUsersList();

    await createEnhancedActivityLog(prisma, req, {
      userId: session.user.id,
      action: 'VIEW_USERS',
      severity: 'INFO',
      category: 'USER',
      metadata: {
        userId: session.user.id,
      },
    });

    return NextResponse.json(users);
  } catch (error) {
    console.error('[USERS_GET_ERROR]', error);
    return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 });
  }
}

/**
 * Creates a single user directly (staff-provisioned account), unlike self-service
 * signup. Restricted to ADMIN/FACULTY/TA. Validates email, password strength, and
 * timezone, and rejects a duplicate email.
 * @openapi
 * summary: Create a user
 * requestBody:
 *   required: true
 *   content:
 *     application/json:
 *       schema:
 *         type: object
 *         required: [email, firstName, lastName, password]
 *         properties:
 *           email: { type: string }
 *           firstName: { type: string }
 *           lastName: { type: string }
 *           password: { type: string, description: Must meet the strength policy }
 *           timezone: { type: string, description: Defaults to the system timezone }
 * responses:
 *   201:
 *     description: The created user.
 *   400: { description: "Missing fields, invalid email, weak password, or invalid timezone." }
 *   403: { description: Caller lacks a staff role. }
 *   409: { description: Email already in use. }
 *   500: { description: Server error. }
 */
export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user || !isAdmin(session.user)) {
      console.warn('[USERS_POST] Unauthorized access attempt');
      await createEnhancedActivityLog(prisma, req, {
        userId: session?.user?.id ?? null,
        action: 'USER_CREATE_DENIED',
        severity: 'SECURITY',
        metadata: {},
      });
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const body = await req.json();
    const { email, firstName, lastName, password, timezone } = body;

    if (!email || !firstName || !lastName || !password) {
      console.warn('[USERS_POST] Missing required fields');
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    if (!isValidEmail(email)) {
      console.warn(`[USERS_POST] Invalid email format: ${email}`);
      return NextResponse.json({ error: 'Invalid email format' }, { status: 400 });
    }

    if (!isStrongPassword(password)) {
      console.warn('[USERS_POST] Weak password provided');
      return NextResponse.json(
        {
          error:
            'Password must be at least 8 characters and include uppercase, lowercase, number, and special character.',
        },
        { status: 400 },
      );
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      console.warn(`[USERS_POST] Email already in use: ${email}`);
      return NextResponse.json({ error: 'Email already in use' }, { status: 409 });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    if (timezone && !COMMON_TIMEZONES.includes(timezone as (typeof COMMON_TIMEZONES)[number])) {
      return NextResponse.json({ error: 'Invalid timezone' }, { status: 400 });
    }

    const systemSettings = await prisma.systemSettings.findUnique({ where: { id: 1 } });

    const newUser = await prisma.user.create({
      data: {
        email,
        firstName,
        lastName,
        password: hashedPassword,
        timezone: timezone || systemSettings?.timezone || 'UTC',
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        createdAt: true,
        timezone: true,
      },
    });

    await createEnhancedActivityLog(prisma, req, {
      userId: session.user.id,
      action: 'CREATE_USER',
      severity: 'INFO',
      category: 'USER',
      metadata: {
        userId: session.user.id,
        createdUserId: newUser.id,
        createdUserEmail: newUser.email,
      },
    });

    return NextResponse.json(newUser, { status: 201 });
  } catch (error) {
    console.error('[USERS_POST_ERROR]', error);
    await createEnhancedActivityLog(prisma, req, {
      userId: null,
      action: 'USER_CREATE_ERROR',
      severity: 'ERROR',
      metadata: { error: error instanceof Error ? error.message : 'unknown error' },
    });
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
