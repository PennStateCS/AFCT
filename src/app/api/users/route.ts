// /src/app/api/users

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcrypt';
import { auth } from '@/lib/auth';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { COMMON_TIMEZONES } from '@/lib/timezones';
import { getUsersList } from '@/lib/users-list';

// Utility to validate email format
const isValidEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

// Utility to validate strong passwords
const isStrongPassword = (pw: string) =>
  pw.length >= 8 &&
  /[A-Z]/.test(pw) &&
  /[a-z]/.test(pw) &&
  /\d/.test(pw) &&
  /[^A-Za-z0-9]/.test(pw); // Must include special character

// GET: Fetch all users (optionally filtered by role)
export async function GET(req: Request) {
  try {
    // 1. Verify session and role
    const session = await auth();
    if (!session || !['ADMIN', 'FACULTY', 'TA'].includes(session.user.role)) {
      console.warn('[USERS_GET] Unauthorized access attempt');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // 2. Extract role filter from query parameters
    const { searchParams } = new URL(req.url);
    const role = searchParams.get('role');

    // Fetching users

    // 3. Query users from the database
    const users = await getUsersList(role);

    // 4. Log the access
    await createEnhancedActivityLog(prisma, req, {
      userId: session.user.id,
      action: 'VIEW_USERS',
      severity: 'INFO',
      category: 'USER',
      metadata: {
        userId: session.user.id,
        filterRole: role,
      },
    });

    return NextResponse.json(users);
  } catch (error) {
    console.error('[USERS_GET_ERROR]', error);
    return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 });
  }
}

// POST: Create a new user
export async function POST(req: Request) {
  try {
    // 1. Verify session and role
    const session = await auth();
    if (!session || !['ADMIN', 'FACULTY', 'TA'].includes(session.user.role)) {
      console.warn('[USERS_POST] Unauthorized access attempt');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // 2. Parse and validate request body
    const body = await req.json();
    const { email, firstName, lastName, password, role, timezone } = body;

    if (!email || !firstName || !lastName || !password || !role) {
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

    // 3. Prevent duplicate users
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      console.warn(`[USERS_POST] Email already in use: ${email}`);
      return NextResponse.json({ error: 'Email already in use' }, { status: 409 });
    }

    // 4. Hash the password and create the user
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
        role,
        password: hashedPassword,
        timezone: timezone || systemSettings?.timezone || 'UTC',
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        createdAt: true,
        timezone: true,
      },
    });

    // User created

    // 5. Log the creation
    await createEnhancedActivityLog(prisma, req, {
      userId: session.user.id,
      action: 'CREATE_USER',
      severity: 'INFO',
      category: 'USER',
      metadata: {
        userId: session.user.id,
        createdUserId: newUser.id,
        createdUserEmail: newUser.email,
        createdUserRole: newUser.role,
      },
    });

    return NextResponse.json(newUser, { status: 201 });
  } catch (error) {
    console.error('[USERS_POST_ERROR]', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
