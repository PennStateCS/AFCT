// /src/app/api/profile/route.ts

import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import path from 'path';
import { writeFile, unlink, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { randomUUID } from 'crypto';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';

const uploadDir = path.join(process.cwd(), 'public', 'uploads');

// Utility to delete a file if it exists
async function deleteFileIfExists(filename: string) {
  const filePath = path.join(uploadDir, filename);
  if (existsSync(filePath)) {
    try {
      await unlink(filePath);
    } catch (err) {
      console.warn(`Could not delete file ${filename}:`, err);
    }
  }
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const formData = await req.formData();
  const firstName = (formData.get('firstName') as string)?.trim();
  const lastName = (formData.get('lastName') as string)?.trim();
  const avatar = formData.get('avatar') as File | null;
  const deleteAvatar = formData.get('deleteAvatar') === 'true';

  if (!firstName || !lastName) {
    return NextResponse.json(
      { error: 'First name and last name cannot be blank.' },
      { status: 400 },
    );
  }

  if (!existsSync(uploadDir)) {
    await mkdir(uploadDir, { recursive: true });
  }

  const currentUser = await prisma.user.findUnique({
    where: { id: session.user.id },
  });

  if (!currentUser) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  let avatarFileName: string | null = currentUser.avatar || null;

  if (avatar && avatar.size > 0) {
    // Save new avatar
    const bytes = await avatar.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const ext = path.extname(avatar.name) || '.png';
    avatarFileName = `${currentUser.id}_${Date.now()}_${randomUUID()}${ext}`;

    if (currentUser.avatar) {
      await deleteFileIfExists(currentUser.avatar);
    }

    await writeFile(path.join(uploadDir, avatarFileName), buffer);
  }

  if (deleteAvatar && currentUser.avatar) {
    await deleteFileIfExists(currentUser.avatar);
    avatarFileName = null;
  }

  const updatedUser = await prisma.user.update({
    where: { id: session.user.id },
    data: {
      firstName,
      lastName,
      avatar: avatarFileName,
    },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      avatar: true,
      role: true,
    },
  });

  // Log profile update
  await createEnhancedActivityLog(prisma, req, {
    userId: session.user.id,
    action: 'PROFILE_UPDATED',
    category: 'USER',
    metadata: {
      firstName,
      lastName,
      avatarUpdated: !!avatar,
      avatarDeleted: deleteAvatar,
    },
  });

  return NextResponse.json(updatedUser, { status: 200 });
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      avatar: true,
      role: true,
    },
  });

  return NextResponse.json(user);
}
