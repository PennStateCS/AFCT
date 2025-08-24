// /src/app/api/users/[id]
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { writeFile, unlink } from 'fs/promises';
import path from 'path';
import { Role } from '@prisma/client';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';

// PATCH: Update a user's profile
export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const userId = id;

  // Attempting to update user: userId

  try {
    const session = await auth();
    const currentUser = session?.user;

    if (!currentUser || !currentUser.id || !currentUser.role) {
      console.warn('[PATCH] Unauthorized request');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const isAdmin = ['ADMIN', 'FACULTY', 'TA'].includes(currentUser.role);
    if (!isAdmin && currentUser.id !== userId) {
      console.warn(`[PATCH] Forbidden: ${currentUser.id} tried to update user ${userId}`);
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Detect content type and prepare values
    const contentType = req.headers.get('content-type') || '';
    let firstName: string | undefined;
    let lastName: string | undefined;
    let role: string | undefined;
    let inactive: boolean | undefined;
    let avatarFile: File | null = null;
    let deleteAvatar = false;

    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      firstName = formData.get('firstName') as string;
      lastName = formData.get('lastName') as string;
      role = formData.get('role') as string;
      inactive = formData.get('inactive') === 'true';
      avatarFile = formData.get('avatar') as File;
      deleteAvatar = formData.get('deleteAvatar') === 'true';
    } else {
      const body = await req.json();
      ({ firstName, lastName, role, inactive } = body);
    }

    // Retrieve current user record
    const userRecord = await prisma.user.findUnique({
      where: { id: userId },
      select: { avatar: true },
    });

    let avatarFilename: string | null | undefined;

    // Save new avatar file and clean up the old one
    if (avatarFile && avatarFile.size > 0) {
      const bytes = Buffer.from(await avatarFile.arrayBuffer());
      avatarFilename = `${userId}-${Date.now()}-${avatarFile.name}`;
      const uploadPath = path.join(process.cwd(), 'public', 'uploads', avatarFilename);
      await writeFile(uploadPath, bytes);
  // Uploaded new avatar: avatarFilename

      if (userRecord?.avatar) {
        const oldPath = path.join(process.cwd(), 'public', 'uploads', userRecord.avatar);
        await unlink(oldPath).catch(() => {});
  // Deleted old avatar
      }
    }

    // Delete avatar if requested
    if (deleteAvatar && userRecord?.avatar) {
      const oldPath = path.join(process.cwd(), 'public', 'uploads', userRecord.avatar);
      await unlink(oldPath).catch(() => {});
      avatarFilename = null;
  // Avatar removed
    }

    // Prepare data for update
    const dataToUpdate: {
      firstName?: string;
      lastName?: string;
      avatar?: string | null;
      role?: Role;
      inactive?: boolean;
    } = {
      firstName: firstName ?? undefined,
      lastName: lastName ?? undefined,
      avatar: avatarFilename !== undefined ? avatarFilename : undefined,
    };
    if (isAdmin) {
      dataToUpdate.role = (role as Role) ?? undefined;
      dataToUpdate.inactive = inactive ?? undefined;
    }

    // Perform the update
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: dataToUpdate,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        inactive: true,
        avatar: true,
      },
    });

    // Log activity
    await createEnhancedActivityLog(prisma, req, {
      userId: currentUser.id,
      action: 'UPDATE_USER',
      category: 'USER',
      metadata: {
        targetUserId: userId,
        updatedFields: Object.keys(dataToUpdate),
      },
    });

  // User updated
    return NextResponse.json(updatedUser);
  } catch (error) {
    console.error('[PATCH] Error updating user:', error);
    return NextResponse.json({ error: 'Failed to update user' }, { status: 500 });
  }
}

// DELETE: Delete a user
export async function DELETE(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const userId = id;

  // Attempting to delete user

  try {
    const session = await auth();
    const currentUser = session?.user;

    if (!currentUser || !['ADMIN', 'FACULTY', 'TA'].includes(currentUser.role)) {
      console.warn(`[DELETE] Forbidden: ${currentUser?.id} tried to delete user ${userId}`);
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Delete avatar file if exists
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { avatar: true },
    });

    if (user?.avatar) {
      const avatarPath = path.join(process.cwd(), 'public', 'uploads', user.avatar);
      await unlink(avatarPath).catch(() => {});
  // Avatar file deleted
    }

    // Delete user from database
    await prisma.user.delete({
      where: { id: userId },
    });

    // Log activity
    await createEnhancedActivityLog(prisma, req, {
      userId: currentUser.id,
      action: 'DELETE_USER',
      category: 'USER',
      metadata: {
        deletedUserId: userId,
      },
    });

  // User deleted
    return NextResponse.json({ success: true, message: 'User deleted' });
  } catch (error) {
    console.error('[DELETE] Error deleting user:', error);
    return NextResponse.json({ error: 'Failed to delete user' }, { status: 500 });
  }
}

// Block unsupported methods
export function GET() {
  return NextResponse.json({ error: 'Method not allowed' }, { status: 405 });
}

export function POST() {
  return NextResponse.json({ error: 'Method not allowed' }, { status: 405 });
}
