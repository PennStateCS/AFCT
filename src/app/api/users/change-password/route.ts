// /src/app/api/users/change-password/

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/authOptions';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcrypt';

export async function POST(req: NextRequest) {
  try {
    // 1. Verify the current session
    const session = await getServerSession(authOptions);

    if (!session?.user?.id || !session.user.role) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = session.user.id;
    const userRole = session.user.role;

    // 2. Only users with valid roles can access this route
    const ALLOWED_ROLES = ['STUDENT', 'TA', 'FACULTY', 'ADMIN'];
    if (!ALLOWED_ROLES.includes(userRole)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // 3. Parse and validate incoming data
    const { oldPassword, newPassword } = await req.json();

    if (!oldPassword || !newPassword) {
      return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
    }

    if (newPassword.length < 8) {
      return NextResponse.json(
        { error: 'Password must be at least 8 characters long' },
        { status: 400 },
      );
    }

    // 4. Fetch the user from the database
    const user = await prisma.user.findUnique({ where: { id: userId } });

    if (!user?.password) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // 5. Validate old password
    const isValid = await bcrypt.compare(oldPassword, user.password);
    if (!isValid) {
      return NextResponse.json({ error: 'Incorrect old password' }, { status: 400 });
    }

    // 6. Prevent reusing the same password
    const isSameAsOld = await bcrypt.compare(newPassword, user.password);
    if (isSameAsOld) {
      return NextResponse.json(
        { error: 'New password cannot be the same as the old password' },
        { status: 400 },
      );
    }

    // 7. Hash and update the new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword },
    });

    // 8. Log the password change in the activity log
    const ip =
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      req.headers.get('x-real-ip') ||
      'unknown';

    await prisma.activityLog.create({
      data: {
        userId,
        action: 'CHANGE_PASSWORD',
        metadata: {
          role: userRole,
          ipAddress: ip,
        },
      },
    });

    // 9. Return success response
    return NextResponse.json({ success: true, message: 'Password updated successfully' });
  } catch (err) {
    console.error('[CHANGE_PASSWORD_ERROR]', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
