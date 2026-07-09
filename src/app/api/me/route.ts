// /src/app/api/me/route.ts

import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import path from 'path';
import { writeFile, unlink, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { randomUUID } from 'crypto';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { COMMON_TIMEZONES } from '@/lib/timezones';
import { getSystemUploadLimit } from '@/lib/upload-limits';
import { formBool } from '@/lib/api/request';

const uploadDir = path.join('/private', 'uploads', 'pfps');

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

/**
 * Updates the signed-in user's own profile: names, timezone, and avatar. The
 * avatar is written to disk and any previous file is removed; `deleteAvatar`
 * clears it instead. Sent as multipart/form-data because it carries a file.
 * @openapi
 * summary: Update my profile
 * requestBody:
 *   required: true
 *   content:
 *     multipart/form-data:
 *       schema:
 *         type: object
 *         required: [firstName, lastName]
 *         properties:
 *           firstName: { type: string }
 *           lastName: { type: string }
 *           timezone: { type: string, description: One of the app's common timezones; blank clears it }
 *           avatar: { type: string, format: binary, description: New profile image }
 *           deleteAvatar: { type: string, enum: ['true'], description: Remove the current avatar }
 * responses:
 *   200:
 *     description: The updated profile.
 *     content:
 *       application/json:
 *         schema:
 *           type: object
 *           properties:
 *             id: { type: string }
 *             email: { type: string }
 *             firstName: { type: string }
 *             lastName: { type: string }
 *             avatar: { type: string, nullable: true }
 *             timezone: { type: string, nullable: true }
 *   400: { description: Blank name or invalid timezone. }
 *   401: { description: Not signed in. }
 *   404: { description: User not found. }
 *   413: { description: Avatar exceeds the system upload limit. }
 *   500: { description: Update failed. }
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id || session.user.inactive) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const formData = await req.formData();
    const firstName = (formData.get('firstName') as string)?.trim();
    const lastName = (formData.get('lastName') as string)?.trim();
    const avatar = formData.get('avatar') as File | null;
    const deleteAvatar = formBool(formData, 'deleteAvatar');
    const timezoneRaw = (formData.get('timezone') as string | null)?.trim() || '';
    const { maxBytes, maxMb } = await getSystemUploadLimit();

    if (!firstName || !lastName) {
      return NextResponse.json(
        { error: 'First name and last name cannot be blank.' },
        { status: 400 },
      );
    }

    if (
      timezoneRaw &&
      !COMMON_TIMEZONES.includes(timezoneRaw as (typeof COMMON_TIMEZONES)[number])
    ) {
      return NextResponse.json({ error: 'Invalid timezone.' }, { status: 400 });
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
      if (avatar.size > maxBytes) {
        return NextResponse.json(
          { error: `File exceeds max upload size (${maxMb} MB).` },
          { status: 413 },
        );
      }
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
        timezone: timezoneRaw || null,
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        avatar: true,
        timezone: true,
      },
    });

    // Log profile update
    await createEnhancedActivityLog(prisma, req, {
      userId: session.user.id,
      action: 'PROFILE_UPDATED',
      severity: 'INFO',
      category: 'USER',
      metadata: {
        userId: session.user.id,
        userFirstName: firstName,
        userLastName: lastName,
        avatarUpdated: !!avatar,
        avatarDeleted: deleteAvatar,
      },
    });

    return NextResponse.json(updatedUser, { status: 200 });
  } catch (error) {
    console.error('[PROFILE_UPDATE_ERROR]', error);
    await createEnhancedActivityLog(prisma, req, {
      userId: session.user.id,
      action: 'PROFILE_UPDATE_ERROR',
      severity: 'ERROR',
      category: 'USER',
      metadata: { error: error instanceof Error ? error.message : 'unknown error' },
    });
    return NextResponse.json({ error: 'Failed to update profile.' }, { status: 500 });
  }
}

/**
 * Returns the signed-in user's own profile.
 * @openapi
 * summary: Get my profile
 * responses:
 *   200:
 *     description: The current user's profile.
 *     content:
 *       application/json:
 *         schema:
 *           type: object
 *           properties:
 *             id: { type: string }
 *             email: { type: string }
 *             firstName: { type: string }
 *             lastName: { type: string }
 *             avatar: { type: string, nullable: true }
 *             timezone: { type: string, nullable: true }
 *   401: { description: Not signed in. }
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id || session.user.inactive) {
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
      timezone: true,
    },
  });

  return NextResponse.json(user);
}
