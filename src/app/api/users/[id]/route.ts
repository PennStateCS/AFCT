// /src/app/api/users/[id]

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/authOptions';
import { writeFile, unlink } from 'fs/promises';
import path from 'path';

// PATCH: Update a user's profile
export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const userId = id;

    // Get the currently logged-in user
    const session = await getServerSession(authOptions);
    const currentUser = session?.user;

    if (!currentUser || !currentUser.id || !currentUser.role) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Restrict students to only updating themselves
    const isAdmin = ['ADMIN', 'FACULTY', 'TA'].includes(currentUser.role);
    if (!isAdmin && currentUser.id !== userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Detect content type to support JSON and form-data
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

    // Fetch current user to check for existing avatar
    const userRecord = await prisma.user.findUnique({
      where: { id: userId },
      select: { avatar: true },
    });

    let avatarFilename: string | null | undefined;

    // Handle avatar upload and cleanup
    if (avatarFile && avatarFile.size > 0) {
      const bytes = Buffer.from(await avatarFile.arrayBuffer());
      avatarFilename = `${userId}-${Date.now()}-${avatarFile.name}`;
      const uploadPath = path.join(process.cwd(), 'public', 'uploads', avatarFilename);
      await writeFile(uploadPath, bytes);

      if (userRecord?.avatar) {
        const oldPath = path.join(process.cwd(), 'public', 'uploads', userRecord.avatar);
        await unlink(oldPath).catch(() => {}); // Ignore if already deleted
      }
    }

    // Handle avatar deletion
    if (deleteAvatar && userRecord?.avatar) {
      const oldPath = path.join(process.cwd(), 'public', 'uploads', userRecord.avatar);
      await unlink(oldPath).catch(() => {});
      avatarFilename = null;
    }

    // Only admins can change role/inactive status
    const dataToUpdate: any = {
      firstName: firstName ?? undefined,
      lastName: lastName ?? undefined,
      avatar: avatarFilename !== undefined ? avatarFilename : undefined,
    };
    if (isAdmin) {
      dataToUpdate.role = role ?? undefined;
      dataToUpdate.inactive = inactive ?? undefined;
    }

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

    // Log the update
    const ip =
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      req.headers.get('x-real-ip') ||
      'unknown';

    await prisma.activityLog.create({
      data: {
        userId: currentUser.id,
        action: 'UPDATE_USER',
        metadata: {
          targetUserId: userId,
          updatedFields: Object.keys(dataToUpdate),
          ipAddress: ip,
        },
      },
    });

    return NextResponse.json(updatedUser);
  } catch (error) {
    console.error('Error updating user:', error);
    return NextResponse.json({ error: 'Failed to update user' }, { status: 500 });
  }
}

// DELETE: Delete a user (admin/ta/faculty only)
export async function DELETE(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const userId = id;

    // Check session and role
    const session = await getServerSession(authOptions);
    const currentUser = session?.user;

    if (!currentUser || !['ADMIN', 'FACULTY', 'TA'].includes(currentUser.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Get avatar path if needed
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { avatar: true },
    });

    if (user?.avatar) {
      const avatarPath = path.join(process.cwd(), 'public', 'uploads', user.avatar);
      await unlink(avatarPath).catch(() => {});
    }

    await prisma.user.delete({
      where: { id: userId },
    });

    // Log the deletion
    const ip =
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      req.headers.get('x-real-ip') ||
      'unknown';

    await prisma.activityLog.create({
      data: {
        userId: currentUser.id,
        action: 'DELETE_USER',
        metadata: {
          deletedUserId: userId,
          ipAddress: ip,
        },
      },
    });

    return NextResponse.json({ success: true, message: 'User deleted' });
  } catch (error) {
    console.error('Error deleting user:', error);
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
