// /src/app/api/users/[id]
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { writeFile, unlink } from 'fs/promises';
import path from 'path';
import { Role } from '@prisma/client';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { parseRole } from '@/lib/roles';
import { COMMON_TIMEZONES } from '@/lib/timezones';
import { getSystemUploadLimit } from '@/lib/upload-limits';

// PATCH: Update a user's profile
export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const userId = id;
  let actorId: string | null = null;

  // Attempting to update user: userId

  try {
    const session = await auth();
    const currentUser = session?.user;

    if (!currentUser || !currentUser.id || !currentUser.role) {
      console.warn('[PATCH] Unauthorized request');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    actorId = currentUser.id;

    const isAdminOnly = currentUser.role === 'ADMIN';
    const canEdit =
      isAdminOnly || currentUser.id === userId || ['FACULTY', 'TA'].includes(currentUser.role);
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

    // Save new avatar file and clean up the old one
    if (avatarFile && avatarFile.size > 0) {
      const bytes = Buffer.from(await avatarFile.arrayBuffer());
      avatarFilename = `${userId}-${Date.now()}-${avatarFile.name}`;
      const uploadPath = path.join('/private', 'uploads', 'pfps', avatarFilename);
      await writeFile(uploadPath, bytes);
      // Uploaded new avatar: avatarFilename

      if (userRecord?.avatar) {
        const oldPath = path.join('/private', 'uploads', 'pfps', userRecord.avatar);
        await unlink(oldPath).catch(() => {});
        // Deleted old avatar
      }
    }

    // Delete avatar if requested
    if (deleteAvatar && userRecord?.avatar) {
      const oldPath = path.join('/private', 'uploads', 'pfps', userRecord.avatar);
      await unlink(oldPath).catch(() => {});
      avatarFilename = null;
      // Avatar removed
    }

    // Make sure the user is not in any active courses if changing active status
    if (inactive) {
      // Note logic appears swapped, but that is because inactive is the next state
      // Generate the current date and time
      const currTime = new Date();

      // Find if the user is in an active coruse
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

      // Return an error if the user is in an active course
      if (activeCourses) {
        // Make sure the active course is not archived
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

    // Prepare data for update
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
      role: role,
      inactive: inactive,
      timezone: timezoneRaw ? timezoneRaw : undefined,
    };

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

    // User updated
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

// DELETE: Delete a user
export async function DELETE(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const userId = id;
  let actorId: string | null = null;

  // Attempting to delete user

  try {
    const session = await auth();
    const currentUser = session?.user;

    if (!currentUser || !['ADMIN', 'FACULTY', 'TA'].includes(currentUser.role)) {
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

    // Valid to delete
    // Capture the target's identity before the row is gone, for the audit + avatar cleanup.
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { avatar: true, email: true, firstName: true, lastName: true, role: true },
    });

    if (user?.avatar) {
      const avatarPath = path.join('/private', 'uploads', 'pfps', user.avatar);
      await unlink(avatarPath).catch(() => {});
      // Avatar file deleted
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

    // User deleted
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

// Block unsupported methods
export function GET() {
  return NextResponse.json({ error: 'Method not allowed' }, { status: 405 });
}

export function POST() {
  return NextResponse.json({ error: 'Method not allowed' }, { status: 405 });
}
