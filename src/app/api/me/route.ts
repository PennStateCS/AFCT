// /src/app/api/me/route.ts

import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import path from 'path';
import { writeFile, unlink, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { logError } from '@/lib/api/activity';
import { getSystemUploadLimit } from '@/lib/upload-limits';
import { safeStoredFilename, resolveInsideDir } from '@/lib/safe-upload';
import { readFormData } from '@/lib/api/request';
import { UserProfileApiSchema } from '@/schemas/profile';

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
    // Validate the scalar fields (names required, timezone allow-list, deleteAvatar)
    // server-side; the avatar File stays on the raw form.
    const parsed = await readFormData(req, UserProfileApiSchema);
    if (!parsed.ok) return parsed.response;
    const { firstName, lastName, deleteAvatar } = parsed.data;
    const timezoneRaw = parsed.data.timezone ?? '';
    const avatar = parsed.form.get('avatar') as File | null;
    const { maxBytes, maxMb } = await getSystemUploadLimit();

    if (!existsSync(uploadDir)) {
      await mkdir(uploadDir, { recursive: true });
    }

    const currentUser = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { id: true, avatar: true },
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
      // Reject anything that isn't an image (defense-in-depth; avatars are also
      // served as octet-stream attachments so an odd file can't execute).
      if (avatar.type && !avatar.type.startsWith('image/')) {
        return NextResponse.json({ error: 'Avatar must be an image file.' }, { status: 400 });
      }
      // Store under a random, non-client-derived name (userId prefix + UUID +
      // sanitized extension) and write through the traversal-safe resolver,
      // matching the other upload paths.
      const bytes = await avatar.arrayBuffer();
      const buffer = Buffer.from(bytes);
      avatarFileName = safeStoredFilename(avatar.name, `${currentUser.id}_`);

      if (currentUser.avatar) {
        await deleteFileIfExists(currentUser.avatar);
      }

      await writeFile(resolveInsideDir(uploadDir, avatarFileName), buffer);
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
        userFirstName: firstName,
        userLastName: lastName,
        avatarUpdated: !!(avatar && avatar.size > 0),
        avatarDeleted: !!(deleteAvatar && currentUser.avatar),
        timezone: timezoneRaw || null,
      },
    });

    return NextResponse.json(updatedUser, { status: 200 });
  } catch (error) {
    console.error('[PROFILE_UPDATE_ERROR]', error);
    await logError(req, {
      userId: session.user.id,
      action: 'PROFILE_UPDATE_ERROR',
      error,
      category: 'USER',
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
