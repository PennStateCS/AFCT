import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { writeFile } from 'fs/promises';
import path from 'path';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { logError } from '@/lib/api/activity';
import { isAdmin } from '@/lib/permissions';
import { COMMON_TIMEZONES } from '@/lib/timezones';
import { getSystemUploadLimit } from '@/lib/upload-limits';
import { safeStoredFilename, resolveInsideDir, safeUnlinkInDir } from '@/lib/safe-upload';
import { readFormData, readJson } from '@/lib/api/request';
import { UserUpdateJsonApiSchema, UserUpdateFormApiSchema } from '@/schemas/user';

// Avatars are stored here; the client-supplied name is never used to build a path.
const pfpsDir = path.join('/private', 'uploads', 'pfps');

/**
 * Updates a user: names, admin flag, active status, timezone, and avatar. Accepts
 * either JSON or multipart/form-data (the latter carries the avatar file). A user
 * may edit themselves; only admins may edit others or change the admin flag.
 * Deactivation is blocked while the user is still on a published, unarchived
 * course. Field-level changes are recorded (before → after) in the audit log.
 * @openapi
 * summary: Update a user
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 * requestBody:
 *   required: true
 *   content:
 *     application/json:
 *       schema:
 *         type: object
 *         properties:
 *           firstName: { type: string }
 *           lastName: { type: string }
 *           isAdmin: { type: boolean, description: Global admin flag (only writable by admins) }
 *           inactive: { type: boolean }
 *           timezone: { type: string }
 *     multipart/form-data:
 *       schema:
 *         type: object
 *         properties:
 *           firstName: { type: string }
 *           lastName: { type: string }
 *           inactive: { type: string, enum: ['true', 'false'] }
 *           timezone: { type: string }
 *           avatar: { type: string, format: binary }
 *           deleteAvatar: { type: string, enum: ['true'] }
 * responses:
 *   200:
 *     description: The updated user.
 *   400: { description: Invalid timezone. }
 *   401: { description: Not signed in. }
 *   403: { description: "Not allowed to edit this user, or deactivating an actively-enrolled user." }
 *   413: { description: Avatar exceeds the system upload limit. }
 *   500: { description: Server error. }
 */
export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const userId = id;
  let actorId: string | null = null;

  try {
    const session = await auth();
    const currentUser = session?.user;

    if (!currentUser || !currentUser.id || currentUser.inactive) {
      console.warn('[PATCH] Unauthorized request');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    actorId = currentUser.id;

    // A user may edit their own account; otherwise only admins may edit others.
    const canEdit = isAdmin(currentUser) || currentUser.id === userId;
    if (!canEdit) {
      console.warn(`[PATCH] Forbidden: ${currentUser.id} tried to update user ${userId}`);
      await createEnhancedActivityLog(prisma, req, {
        userId: session?.user?.id ?? null,
        action: 'USER_UPDATE_DENIED',
        severity: 'SECURITY',
        metadata: { targetUserId: userId },
      });
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Detect content type and prepare values
    const contentType = req.headers.get('content-type') || '';
    let firstName: string | undefined;
    let lastName: string | undefined;
    let inactive: boolean | undefined;
    let avatarFile: File | null = null;
    let deleteAvatar = false;
    let timezoneRaw: string | undefined;
    // The global admin flag — only applied when the actor is themselves an admin.
    let isAdminFlag: boolean | undefined;

    if (contentType.includes('multipart/form-data')) {
      const parsed = await readFormData(req, UserUpdateFormApiSchema);
      if (!parsed.ok) return parsed.response;
      firstName = parsed.data.firstName;
      lastName = parsed.data.lastName;
      inactive = parsed.data.inactive;
      deleteAvatar = parsed.data.deleteAvatar;
      timezoneRaw = parsed.data.timezone || undefined;
      isAdminFlag = parsed.data.isAdmin;
      avatarFile = parsed.form.get('avatar') as File;
    } else {
      const parsed = await readJson(req, UserUpdateJsonApiSchema);
      if (!parsed.ok) return parsed.response;
      firstName = parsed.data.firstName;
      lastName = parsed.data.lastName;
      inactive = parsed.data.inactive;
      timezoneRaw = parsed.data.timezone;
      isAdminFlag = parsed.data.isAdmin;
    }
    if (
      timezoneRaw &&
      !COMMON_TIMEZONES.includes(timezoneRaw as (typeof COMMON_TIMEZONES)[number])
    ) {
      return NextResponse.json({ error: 'Invalid timezone' }, { status: 400 });
    }

    const { maxBytes, maxMb } = await getSystemUploadLimit();
    if (avatarFile && avatarFile.size > 0 && avatarFile.size > maxBytes) {
      return NextResponse.json(
        { error: `File exceeds max upload size (${maxMb} MB).` },
        { status: 413 },
      );
    }

    // Retrieve current user record
    const userRecord = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        avatar: true,
        firstName: true,
        lastName: true,
        isAdmin: true,
        inactive: true,
        timezone: true,
      },
    });

    let avatarFilename: string | null | undefined;

    // Write the new avatar, then remove the previous file so uploads don't pile up.
    // Stored under a random UUID + sanitized extension (userId prefix for
    // readability), never a path derived from the client-supplied avatar.name, and
    // written non-executable.
    if (avatarFile && avatarFile.size > 0) {
      const bytes = Buffer.from(await avatarFile.arrayBuffer());
      avatarFilename = safeStoredFilename(avatarFile.name, `${userId}-`);
      await writeFile(resolveInsideDir(pfpsDir, avatarFilename), bytes, { mode: 0o644 });

      if (userRecord?.avatar) {
        await safeUnlinkInDir(pfpsDir, userRecord.avatar);
      }
    }

    if (deleteAvatar && userRecord?.avatar) {
      await safeUnlinkInDir(pfpsDir, userRecord.avatar);
      avatarFilename = null;
    }

    // Don't let someone be deactivated while they're still on a live course
    // (published and not archived, end date in the future).
    if (inactive) {
      const currTime = new Date();

      const activeCourses = await prisma.roster.findMany({
        where: {
          userId: userId,
          course: {
            endDate: {
              gte: currTime,
            },
          },
        },
        select: { course: { select: { isArchived: true, isPublished: true } } },
      });

      if (activeCourses) {
        for (const activeCourse of activeCourses) {
          if (!activeCourse.course.isArchived && activeCourse.course.isPublished) {
            console.error(
              '[PATCH] Error updating user: User in an unarchived active course cannot be inactive',
            );
            await createEnhancedActivityLog(prisma, req, {
              userId: session?.user?.id ?? null,
              action: 'USER_UPDATE_REJECTED',
              severity: 'WARNING',
              metadata: { targetUserId: userId, reason: 'active-course' },
            });
            return NextResponse.json(
              { error: 'Users in an active course cannot be inactive' },
              { status: 403 },
            );
          }
        }
      }
    }

    // Only fields that were actually supplied become `undefined` → left untouched.
    const dataToUpdate: {
      firstName?: string;
      lastName?: string;
      avatar?: string | null;
      isAdmin?: boolean;
      inactive?: boolean;
      timezone?: string | null;
    } = {
      firstName: firstName ?? undefined,
      lastName: lastName ?? undefined,
      avatar: avatarFilename !== undefined ? avatarFilename : undefined,
      // Only admins may change a user's admin flag; self-editors cannot escalate.
      isAdmin: isAdmin(currentUser) ? isAdminFlag : undefined,
      inactive: inactive,
      timezone: timezoneRaw ? timezoneRaw : undefined,
    };

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: dataToUpdate,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        isAdmin: true,
        inactive: true,
        avatar: true,
        timezone: true,
      },
    });

    // Record exactly what changed (before → after). Admin-flag and active-status
    // changes especially matter when an admin edits another account.
    const AUDITED_USER_FIELDS = [
      'firstName',
      'lastName',
      'isAdmin',
      'inactive',
      'timezone',
    ] as const;
    const changes: Record<string, { from: string | boolean | null; to: string | boolean | null }> =
      {};
    for (const field of AUDITED_USER_FIELDS) {
      const to = dataToUpdate[field];
      if (to === undefined) continue; // not part of this update
      const from = (userRecord?.[field] ?? null) as string | boolean | null;
      const next = to as string | boolean | null;
      if (from !== next) changes[field] = { from, to: next };
    }

    await createEnhancedActivityLog(prisma, req, {
      userId: actorId,
      action: 'UPDATE_USER',
      severity: 'INFO',
      category: 'USER',
      metadata: {
        targetUserId: userId,
        changedFields: Object.keys(changes),
        changes,
        avatarChanged: dataToUpdate.avatar !== undefined,
      },
    });

    return NextResponse.json(updatedUser);
  } catch (error) {
    console.error('[PATCH] Error updating user:', error);
    await logError(req, {
      userId: actorId,
      action: 'USER_UPDATE_ERROR',
      error,
    });
    return NextResponse.json({ error: 'Failed to update user' }, { status: 500 });
  }
}

/**
 * Deletes a user. System administrators only. The user's activity logs are
 * deliberately preserved (schema `onDelete: SetNull` nulls their userId; each
 * entry keeps the actor's name/email in metadata), and their avatar file is
 * cleaned up. The deleted identity is captured for the audit entry before removal.
 * @openapi
 * summary: Delete a user
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 * responses:
 *   200:
 *     description: User deleted.
 *     content:
 *       application/json:
 *         schema: { type: object, properties: { success: { type: boolean }, message: { type: string } } }
 *   403: { description: System administrators only (also returned when not signed in). }
 *   500: { description: Server error. }
 */
export async function DELETE(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const userId = id;
  let actorId: string | null = null;

  try {
    const session = await auth();
    const currentUser = session?.user;

    if (!currentUser || !isAdmin(currentUser)) {
      console.warn(`[DELETE] Forbidden: ${currentUser?.id} tried to delete user ${userId}`);
      await createEnhancedActivityLog(prisma, req, {
        userId: session?.user?.id ?? null,
        action: 'USER_DELETE_DENIED',
        severity: 'SECURITY',
        metadata: { targetUserId: userId },
      });
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    actorId = currentUser.id;

    // Capture the target's identity before the row is gone, for the audit + avatar cleanup.
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { avatar: true, email: true, firstName: true, lastName: true },
    });

    if (user?.avatar) {
      await safeUnlinkInDir(pfpsDir, user.avatar);
    }

    // Delete user from database. The user's activity logs are intentionally
    // preserved for the audit trail — the schema's onDelete: SetNull nulls their
    // userId, and each entry keeps the actor's name/email in metadata.
    await prisma.user.delete({
      where: { id: userId },
    });

    // Log activity — record who was deleted, since the user row is now gone.
    await createEnhancedActivityLog(prisma, req, {
      userId: actorId,
      action: 'DELETE_USER',
      severity: 'INFO',
      category: 'USER',
      metadata: {
        targetUserId: userId,
        deletedUserEmail: user?.email ?? null,
        deletedUserName: [user?.firstName, user?.lastName].filter(Boolean).join(' ') || null,
      },
    });

    return NextResponse.json({ success: true, message: 'User deleted' });
  } catch (error) {
    console.error('[DELETE] Error deleting user:', error);
    await logError(req, {
      userId: actorId,
      action: 'USER_DELETE_ERROR',
      error,
    });
    return NextResponse.json({ error: 'Failed to delete user' }, { status: 500 });
  }
}

// This resource is edit/delete only; GET and POST are explicitly rejected so they
// don't fall through to a framework default.
/**
 * @openapi
 * summary: Not supported
 * description: This resource only supports PATCH and DELETE.
 * responses:
 *   405: { description: Method not allowed. }
 */
export function GET() {
  return NextResponse.json({ error: 'Method not allowed' }, { status: 405 });
}

/**
 * @openapi
 * summary: Not supported
 * description: This resource only supports PATCH and DELETE.
 * responses:
 *   405: { description: Method not allowed. }
 */
export function POST() {
  return NextResponse.json({ error: 'Method not allowed' }, { status: 405 });
}
