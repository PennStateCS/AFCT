// /src/app/api/auth/check-email

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// Handle GET requests to check if an email is already registered
export async function GET(request: Request) {
  // Parse the email query parameter from the request URL
  const { searchParams } = new URL(request.url);
  const email = searchParams.get('email');

  // If no email is provided, return a 400 Bad Request
  if (!email) {
    return NextResponse.json({ error: 'Email is required.' }, { status: 400 });
  }

  // Query the database to find a user with the given email
  const existingUser = await prisma.user.findUnique({
    where: { email },
    select: { id: true }, // Only fetch the user's ID for existence check
  });

  // Return a JSON response indicating whether the user exists
  return NextResponse.json({ exists: !!existingUser });
}
