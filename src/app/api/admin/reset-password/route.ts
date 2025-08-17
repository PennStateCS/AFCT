// /src/app/api/admin/reset-password

import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcrypt';



export async function POST(req: Request) {
  // Retrieve the current authenticated session
  const session = await auth();

  // Restrict access to users with ADMIN or FACULTY roles only
  if (!session || !['ADMIN', 'FACULTY'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  // Parse the request body for userId and newPassword
  const { userId, newPassword } = await req.json();

  // Validate presence of required fields
  if (!userId || !newPassword) {
    return NextResponse.json({ error: 'Missing userId or newPassword' }, { status: 400 });
  }

  // Enforce strong password policy
  if (
    newPassword.length < 8 || // At least 8 characters
    !/[A-Z]/.test(newPassword) || // At least one uppercase letter
    !/[a-z]/.test(newPassword) || // At least one lowercase letter
    !/\d/.test(newPassword) // At least one digit
  ) {
    return NextResponse.json({ error: 'Password does not meet requirements' }, { status: 400 });
  }

  try {
    // Hash the new password securely
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update the user's password in the database
    await prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword },
    });

    // Extract IP address from the request headers
    const ip =
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      req.headers.get('x-real-ip') ||
      'unknown';

    // Log the password reset action to ActivityLog
    await prisma.activityLog.create({
      data: {
        userId: session.user.id,
        action: 'RESET_PASSWORD',
        metadata: {
          targetUserId: userId,
          ipAddress: ip,
        },
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    // Log any unexpected error to the server console
    console.error('Reset password error:', error);
    return NextResponse.json({ error: 'Failed to reset password' }, { status: 500 });
  }
}
