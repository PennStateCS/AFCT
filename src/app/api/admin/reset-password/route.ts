// /src/app/api/admin/reset-password

import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcrypt';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { isStrongPassword, passwordRequirementText } from '@/lib/password-policy';

export async function POST(req: Request) {
  // Retrieve the current authenticated session
  const session = await auth();

  // Restrict access to users with ADMIN or FACULTY roles only
  if (!session || !['ADMIN', 'FACULTY'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  // Parse the request body for userId and newPassword
  const { userId, newPassword, isTemporary = false } = await req.json();

  // Validate presence of required fields
  if (!userId || !newPassword) {
    return NextResponse.json({ error: 'Missing userId or newPassword' }, { status: 400 });
  }

  // Enforce strong password policy
  if (!isStrongPassword(newPassword)) {
    return NextResponse.json({ error: passwordRequirementText }, { status: 400 });
  }

  try {
    // Hash the new password securely
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update the user's password in the database
    await prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword, temporaryPassword: Boolean(isTemporary) },
    });

    // Log the password reset action to ActivityLog
    await createEnhancedActivityLog(prisma, req, {
      userId: session.user.id,
      action: 'RESET_PASSWORD',
      category: 'USER',
      metadata: {
        userId: session.user.id,
        initiatedByRole: session.user.role,
        targetUserId: userId,
        temporaryPassword: Boolean(isTemporary),
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    // Log any unexpected error to the server console
    console.error('Reset password error:', error);
    return NextResponse.json({ error: 'Failed to reset password' }, { status: 500 });
  }
}
