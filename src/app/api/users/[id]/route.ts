import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { writeFile, unlink } from 'fs/promises';
import path from 'path';

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const userId = id; // ✅ Ensure userId is a string

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

    // Fetch current user for avatar cleanup
    const currentUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { avatar: true },
    });

    let avatarFilename: string | null | undefined;

    // Handle new avatar upload and delete old one if exists
    if (avatarFile && avatarFile.size > 0) {
      const bytes = Buffer.from(await avatarFile.arrayBuffer());
      avatarFilename = `${userId}-${Date.now()}-${avatarFile.name}`;
      const uploadPath = path.join(process.cwd(), 'public', 'uploads', avatarFilename);
      await writeFile(uploadPath, bytes);

      if (currentUser?.avatar) {
        const oldPath = path.join(process.cwd(), 'public', 'uploads', currentUser.avatar);
        await unlink(oldPath).catch(() => {}); // ignore if file missing
      }
    }

    // Handle delete avatar flag
    if (deleteAvatar && currentUser?.avatar) {
      const oldPath = path.join(process.cwd(), 'public', 'uploads', currentUser.avatar);
      await unlink(oldPath).catch(() => {}); // ignore if file missing
      avatarFilename = null;
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        firstName: firstName ?? undefined,
        lastName: lastName ?? undefined,
        role: role ?? undefined,
        inactive: inactive ?? undefined,
        avatar: avatarFilename !== undefined ? avatarFilename : undefined,
      },
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

    return NextResponse.json(updatedUser);
  } catch (error) {
    console.error('Error updating user:', error);
    return NextResponse.json({ error: 'Failed to update user' }, { status: 500 });
  }
}

// DELETE: Remove user (with avatar cleanup)
export async function DELETE(_: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const userId = id;

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

    return NextResponse.json({ success: true, message: 'User deleted' });
  } catch (error) {
    console.error('Error deleting user:', error);
    return NextResponse.json({ error: 'Failed to delete user' }, { status: 500 });
  }
}

// Disallow GET and POST on this dynamic route
export function GET() {
  return NextResponse.json({ error: 'Method not allowed' }, { status: 405 });
}

export function POST() {
  return NextResponse.json({ error: 'Method not allowed' }, { status: 405 });
}
