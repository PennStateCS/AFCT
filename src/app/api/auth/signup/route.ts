import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

// Regex for email and password validation
const isValidEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const isStrongPassword = (pw: string) =>
  pw.length >= 8 &&
  /[A-Z]/.test(pw) &&
  /[a-z]/.test(pw) &&
  /\d/.test(pw) &&
  /[^A-Za-z0-9]/.test(pw);

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { firstName, lastName, email, password, role = 'STUDENT' } = body;

    // Check for required fields
    if (!email || !password || !firstName || !lastName) {
      return NextResponse.json({ error: 'Missing required fields.' }, { status: 400 });
    }

    // Validate email format
    if (!isValidEmail(email)) {
      return NextResponse.json({ error: 'Invalid email format.' }, { status: 400 });
    }

    // Validate password strength
    if (!isStrongPassword(password)) {
      return NextResponse.json(
        {
          error:
            'Password must be at least 8 characters and include uppercase, lowercase, number, and special character.',
        },
        { status: 400 },
      );
    }

    // Check for existing user
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return NextResponse.json({ error: 'Email already registered.' }, { status: 409 });
    }

    // Hash password and create user
    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = await prisma.user.create({
      data: {
        email,
        firstName,
        lastName,
        password: hashedPassword,
        role,
      },
    });

    return NextResponse.json({ message: 'User created', userId: newUser.id }, { status: 201 });
  } catch (err) {
    console.error('[SIGNUP_ERROR]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
