// /src/app/api/users

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcrypt';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/authOptions';

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
    const session = await getServerSession(authOptions);
    if (!session || !['ADMIN', 'FACULTY', 'TA'].includes(session.user.role)) {
      console.warn('[USERS_GET] Unauthorized access attempt');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // 2. Extract role filter from query parameters
    const { searchParams } = new URL(req.url);
    const role = searchParams.get('role');

    console.log(`[USERS_GET] Fetching users${role ? ` with role: ${role}` : ''}`);

    // 3. Query users from the database
    const users = await prisma.user.findMany({
      where: role ? { role } : undefined,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        avatar: true,
        inactive: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    // 4. Log the access
    const ip =
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      req.headers.get('x-real-ip') ||
      'unknown';

    await prisma.activityLog.create({
      data: {
        userId: session.user.id,
        action: 'VIEW_USERS',
        metadata: {
          filterRole: role,
          ipAddress: ip,
        },
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
    const session = await getServerSession(authOptions);
    if (!session || !['ADMIN', 'FACULTY', 'TA'].includes(session.user.role)) {
      console.warn('[USERS_POST] Unauthorized access attempt');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // 2. Parse and validate request body
    const body = await req.json();
    const { email, firstName, lastName, password, role } = body;

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

    const newUser = await prisma.user.create({
      data: {
        email,
        firstName,
        lastName,
        role,
        password: hashedPassword,
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        createdAt: true,
      },
    });

    console.log(`[USERS_POST] User created: ${newUser.id} (${newUser.email})`);

    // 5. Log the creation
    const ip =
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      req.headers.get('x-real-ip') ||
      'unknown';

    await prisma.activityLog.create({
      data: {
        userId: session.user.id,
        action: 'CREATE_USER',
        metadata: {
          createdUserId: newUser.id,
          createdUserEmail: newUser.email,
          createdUserRole: newUser.role,
          ipAddress: ip,
        },
      },
    });

    return NextResponse.json(newUser, { status: 201 });
  } catch (error) {
    console.error('[USERS_POST_ERROR]', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
