// /src/app/api/users/change-password/

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcrypt';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';

export async function POST(req: NextRequest) {
  try {
    // 1. Verify the current session (must be logged in)
    const session = await auth();

    if (!session?.user?.id || !session.user.role) {
      console.warn('[CHANGE_PASSWORD] Unauthorized access attempt');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = session.user.id;
    const userRole = session.user.role;

  // Change password attempt

    // 2. Validate role is permitted
    const ALLOWED_ROLES = ['STUDENT', 'TA', 'FACULTY', 'ADMIN'];
    if (!ALLOWED_ROLES.includes(userRole)) {
      console.warn(`[CHANGE_PASSWORD] Forbidden role: ${userRole}`);
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // 3. Parse incoming request body
    const { oldPassword, newPassword } = await req.json();

    if (!oldPassword || !newPassword) {
      console.warn('[CHANGE_PASSWORD] Missing oldPassword or newPassword');
      return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
    }

    if (newPassword.length < 8) {
      console.warn('[CHANGE_PASSWORD] New password too short');
      return NextResponse.json(
        { error: 'Password must be at least 8 characters long' },
        { status: 400 },
      );
    }

    // 4. Fetch the user’s current password hash
    const user = await prisma.user.findUnique({ where: { id: userId } });

    if (!user?.password) {
      console.error('[CHANGE_PASSWORD] User not found in database');
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // 5. Check if the old password matches
    const isValid = await bcrypt.compare(oldPassword, user.password);
    if (!isValid) {
      console.warn(`[CHANGE_PASSWORD] Incorrect old password for user ${userId}`);
      return NextResponse.json({ error: 'Incorrect old password' }, { status: 400 });
    }

    // 6. Prevent reuse of the same password
    const isSameAsOld = await bcrypt.compare(newPassword, user.password);
    if (isSameAsOld) {
      console.warn('[CHANGE_PASSWORD] New password is same as old');
      return NextResponse.json(
        { error: 'New password cannot be the same as the old password' },
        { status: 400 },
      );
    }

    // 7. Hash new password and update in DB
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword },
    });

  // Password successfully updated

    // 8. Log the password change
    await createEnhancedActivityLog(prisma, req, {
      userId,
      action: 'CHANGE_PASSWORD',
      category: 'USER',
      metadata: {
        role: userRole,
      },
    });

    // 9. Respond with success
    return NextResponse.json({ success: true, message: 'Password updated successfully' });
  } catch (err) {
    console.error('[CHANGE_PASSWORD_ERROR]', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
