import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { writeFile, unlink } from 'fs/promises';
import path from 'path';
import { Role } from '@prisma/client';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { isAdmin } from '@/lib/permissions';
import { parseRole } from '@/lib/roles';
import { COMMON_TIMEZONES } from '@/lib/timezones';
import { getSystemUploadLimit } from '@/lib/upload-limits';

/**
 * Updates a user: names, role, active status, timezone, and avatar. Accepts either
 * JSON or multipart/form-data (the latter carries the avatar file). A user may
 * edit themselves; ADMIN/FACULTY/TA may edit others. Deactivation is blocked while
 * the user is still on a published, unarchived course. Field-level changes are
 * recorded (before → after) in the audit log.
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
 *           role: { type: string, enum: [STUDENT, TA, FACULTY, ADMIN] }
 *           inactive: { type: boolean }
 *           timezone: { type: string }
 *     multipart/form-data:
 *       schema:
 *         type: object
 *         properties:
 *           firstName: { type: string }
 *           lastName: { type: string }
 *           role: { type: string }
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

    if (!currentUser || !currentUser.id) {
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
        metadata: { role: session?.user?.role ?? null },
      });
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Detect content type and prepare values
    const contentType = req.headers.get('content-type') || '';
    let firstName: string | undefined;
    let lastName: string | undefined;
    let rawRole: string | undefined;
    let inactive: boolean | undefined;
    let avatarFile: File | null = null;
    let deleteAvatar = false;
    let timezoneRaw: string | undefined;

    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      firstName = formData.get('firstName') as string;
      lastName = formData.get('lastName') as string;
      rawRole = formData.get('role') as string;
      inactive = formData.get('inactive') === 'true';
      avatarFile = formData.get('avatar') as File;
      deleteAvatar = formData.get('deleteAvatar') === 'true';
      timezoneRaw = (formData.get('timezone') as string) || undefined;
    } else {
      const body = await req.json();
      ({ firstName, lastName, inactive } = body);
      rawRole = body.role;
      timezoneRaw = body.timezone;
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

    // Parse/validate role using shared helper
    const role = parseRole(rawRole);

    // Retrieve current user record
    const userRecord = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        avatar: true,
        firstName: true,
        lastName: true,
        role: true,
        inactive: true,
        timezone: true,
      },
    });

    let avatarFilename: string | null | undefined;

    // Write the new avatar, then remove the previous file so uploads don't pile up.
    if (avatarFile && avatarFile.size > 0) {
      const bytes = Buffer.from(await avatarFile.arrayBuffer());
      avatarFilename = `${userId}-${Date.now()}-${avatarFile.name}`;
      const uploadPath = path.join('/private', 'uploads', 'pfps', avatarFilename);
      await writeFile(uploadPath, bytes);

      if (userRecord?.avatar) {
        const oldPath = path.join('/private', 'uploads', 'pfps', userRecord.avatar);
        await unlink(oldPath).catch(() => {});
      }
    }

    if (deleteAvatar && userRecord?.avatar) {
      const oldPath = path.join('/private', 'uploads', 'pfps', userRecord.avatar);
      await unlink(oldPath).catch(() => {});
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
              action: 'USER_UPDATE_DENIED',
              severity: 'SECURITY',
              metadata: { role: session?.user?.role ?? null },
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
      role?: Role;
      inactive?: boolean;
      timezone?: string | null;
    } = {
      firstName: firstName ?? undefined,
      lastName: lastName ?? undefined,
      avatar: avatarFilename !== undefined ? avatarFilename : undefined,
      // Only admins may change a user's role; self-editors cannot escalate.
      role: isAdmin(currentUser) ? role : undefined,
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
        role: true,
        inactive: true,
        avatar: true,
        timezone: true,
      },
    });

    // Record exactly what changed (before → after). Role and active-status
    // changes especially matter when an admin edits another user's account.
    const AUDITED_USER_FIELDS = ['firstName', 'lastName', 'role', 'inactive', 'timezone'] as const;
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
        actorId,
        targetUserId: userId,
        changedFields: Object.keys(changes),
        changes,
        avatarChanged: dataToUpdate.avatar !== undefined,
      },
    });

    return NextResponse.json(updatedUser);
  } catch (error) {
    console.error('[PATCH] Error updating user:', error);
    await createEnhancedActivityLog(prisma, req, {
      userId: actorId,
      action: 'USER_UPDATE_ERROR',
      severity: 'ERROR',
      metadata: { error: error instanceof Error ? error.message : 'unknown error' },
    });
    return NextResponse.json({ error: 'Failed to update user' }, { status: 500 });
  }
}

/**
 * Deletes a user. Restricted to ADMIN/FACULTY/TA. The user's activity logs are
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
 *   403: { description: Caller lacks a staff role. }
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
        metadata: { role: session?.user?.role ?? null },
      });
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    actorId = currentUser.id;

    // Capture the target's identity before the row is gone, for the audit + avatar cleanup.
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { avatar: true, email: true, firstName: true, lastName: true, role: true },
    });

    if (user?.avatar) {
      const avatarPath = path.join('/private', 'uploads', 'pfps', user.avatar);
      await unlink(avatarPath).catch(() => {});
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
        actorId,
        deletedUserId: userId,
        deletedUserEmail: user?.email ?? null,
        deletedUserName: [user?.firstName, user?.lastName].filter(Boolean).join(' ') || null,
        deletedUserRole: user?.role ?? null,
      },
    });

    return NextResponse.json({ success: true, message: 'User deleted' });
  } catch (error) {
    console.error('[DELETE] Error deleting user:', error);
    await createEnhancedActivityLog(prisma, req, {
      userId: actorId,
      action: 'USER_DELETE_ERROR',
      severity: 'ERROR',
      metadata: { error: error instanceof Error ? error.message : 'unknown error' },
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
