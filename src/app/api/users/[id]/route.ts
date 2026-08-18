import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { auth } from '@/lib/auth';
import { writeFile } from 'fs/promises';
import path from 'path';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { logError } from '@/lib/api/activity';
import { isAdmin } from '@/lib/permissions';
import { COMMON_TIMEZONES } from '@/lib/timezones';
import { getSystemUploadLimit } from '@/lib/upload-limits';
import { safeStoredFilename, resolveInsideDir, safeUnlinkInDir } from '@/lib/safe-upload';
import { readAndValidateAvatar } from '@/lib/avatar-upload';
import {
  evaluateAvatarUploadRateLimit,
  formatRetryAfterSeconds,
} from '@/lib/security/rate-limiter';
import { readFormData, readJson } from '@/lib/api/request';
import { UserUpdateJsonApiSchema, UserUpdateFormApiSchema } from '@/schemas/user';
import { invalidateSessionUser } from '@/lib/session-user-cache';

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
 *           email: { type: string, description: New login email (admins only; must be unused) }
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
 *   409: { description: "The change would remove the last active administrator, or the new email is already in use." }
 *   413: { description: Avatar exceeds the system upload limit. }
 *   500: { description: Server error. }
 */
/** Thrown inside the transaction so the rejection unwinds it rather than committing. */
class LastAdminError extends Error {}

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
        category: 'USER',
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
    // Admin-only email change; only ever supplied on the JSON branch.
    let email: string | undefined;
    let avatarFile: File | null = null;
    let deleteAvatar = false;
    let timezoneRaw: string | undefined;
    // The global admin flag, only applied when the actor is themselves an admin.
    let isAdminFlag: boolean | undefined;
    // Avatar framing (position + zoom). Undefined leaves the stored values untouched.
    let cropX: number | undefined;
    let cropY: number | undefined;
    let zoom: number | undefined;

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
      cropX = parsed.data.cropX;
      cropY = parsed.data.cropY;
      zoom = parsed.data.zoom;
    } else {
      const parsed = await readJson(req, UserUpdateJsonApiSchema);
      if (!parsed.ok) return parsed.response;
      firstName = parsed.data.firstName;
      lastName = parsed.data.lastName;
      inactive = parsed.data.inactive;
      email = parsed.data.email;
      timezoneRaw = parsed.data.timezone;
      isAdminFlag = parsed.data.isAdmin;
      cropX = parsed.data.cropX;
      cropY = parsed.data.cropY;
      zoom = parsed.data.zoom;
    }
    if (
      timezoneRaw &&
      !COMMON_TIMEZONES.includes(timezoneRaw as (typeof COMMON_TIMEZONES)[number])
    ) {
      return NextResponse.json({ error: 'Invalid timezone' }, { status: 400 });
    }

    const uploadLimit = await getSystemUploadLimit();

    // Validate the avatar (size + MIME + magic-byte signature) and throttle
    // replacements BEFORE touching disk or the database, so no bytes are written
    // for a request that will be rejected. The decoded buffer is written later,
    // just before the DB update, once every business rule has passed.
    let avatarBuffer: Buffer | null = null;
    const hasAvatarUpload = !!avatarFile && avatarFile.size > 0;
    if (hasAvatarUpload) {
      const decision = evaluateAvatarUploadRateLimit({ identifier: actorId });
      if (decision.status === 'blocked') {
        return NextResponse.json(
          { error: 'Too many avatar changes. Please try again later.' },
          {
            status: 429,
            headers: { 'Retry-After': formatRetryAfterSeconds(decision.retryAfterMs) },
          },
        );
      }
      const validated = await readAndValidateAvatar(avatarFile as File, uploadLimit);
      if (!validated.ok) {
        return NextResponse.json({ error: validated.error }, { status: validated.status });
      }
      avatarBuffer = validated.buffer;
    }

    // Retrieve current user record
    const userRecord = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        avatar: true,
        email: true,
        firstName: true,
        lastName: true,
        isAdmin: true,
        inactive: true,
        timezone: true,
      },
    });

    // Resolve the avatar column value without writing yet: a new random name when
    // replacing, null when clearing, or undefined to leave it untouched.
    let avatarFilename: string | null | undefined;
    if (avatarBuffer) {
      avatarFilename = safeStoredFilename(avatarFile?.name, `${userId}-`);
    } else if (deleteAvatar && userRecord?.avatar) {
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
              category: 'USER',
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

    // Email change (admin-only). The schema already normalized it to a trimmed,
    // lowercase address. Only touch it when it actually differs, and reject a
    // collision up front with a clear 409 (the unique constraint is the real guard;
    // this just gives a friendlier message and skips a pointless write).
    let emailToUpdate: string | undefined;
    if (email !== undefined && isAdmin(currentUser) && email !== userRecord?.email) {
      const taken = await prisma.user.findFirst({
        where: { email, NOT: { id: userId } },
        select: { id: true },
      });
      if (taken) {
        await createEnhancedActivityLog(prisma, req, {
          userId: actorId,
          action: 'USER_UPDATE_REJECTED',
          category: 'USER',
          severity: 'WARNING',
          metadata: { targetUserId: userId, reason: 'email-in-use' },
        });
        return NextResponse.json({ error: 'That email is already in use' }, { status: 409 });
      }
      emailToUpdate = email;
    }

    // Only fields that were actually supplied become `undefined` → left untouched.
    const dataToUpdate: {
      firstName?: string;
      lastName?: string;
      email?: string;
      avatar?: string | null;
      isAdmin?: boolean;
      inactive?: boolean;
      timezone?: string | null;
      cropX?: number;
      cropY?: number;
      zoom?: number;
    } = {
      firstName: firstName ?? undefined,
      lastName: lastName ?? undefined,
      email: emailToUpdate,
      avatar: avatarFilename !== undefined ? avatarFilename : undefined,
      // Only admins may change a user's admin flag; self-editors cannot escalate.
      isAdmin: isAdmin(currentUser) ? isAdminFlag : undefined,
      // `inactive` is a privileged account-state field; a self-editor must not be
      // able to disable (or re-enable) their own account.
      inactive: isAdmin(currentUser) ? inactive : undefined,
      timezone: timezoneRaw ? timezoneRaw : undefined,
      // Avatar framing: written when supplied (repositioning an existing photo or
      // framing a newly uploaded one); undefined leaves the current values in place.
      cropX,
      cropY,
      zoom,
    };

    /**
     * Whether this change would take away somebody's administrator access.
     *
     * The count that guards it is not run here: two administrators demoting each other at the
     * same moment would each see the other and both succeed, leaving none. It runs inside the
     * update's own transaction below, where Postgres can make the pair conflict.
     */
    const losesAdmin =
      (dataToUpdate.isAdmin === false || dataToUpdate.inactive === true) &&
      !!userRecord?.isAdmin &&
      !userRecord.inactive;

    // Now that every rejection path has passed, persist the new avatar to disk
    // (random UUID + sanitized extension, never a client-derived path, written
    // non-executable). The old file is removed only AFTER the DB commit succeeds,
    // and the new file is cleaned up if the commit fails, so a failed or rejected
    // replacement never orphans a multi-MB upload.
    if (avatarBuffer && avatarFilename) {
      await writeFile(resolveInsideDir(pfpsDir, avatarFilename), avatarBuffer, { mode: 0o644 });
    }

    let updatedUser;
    try {
      const write = (client: Prisma.TransactionClient | typeof prisma) =>
        client.user.update({
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

      /**
       * The last-administrator rule, counted and enforced in one serializable transaction.
       *
       * Two administrators demoting each other at the same moment each saw the other and both
       * went through, which is how a deployment ends up with nobody who can administer it and
       * no way to fix it from inside. Serializable makes the pair conflict, so one is rejected
       * with a retry rather than both succeeding. Same shape as the last-faculty invariant on
       * the roster route.
       *
       * An ordinary profile edit does not touch the invariant, so it stays a plain update
       * rather than paying for a serializable transaction it does not need.
       */
      updatedUser = losesAdmin
        ? await prisma.$transaction(
            async (tx) => {
              const otherActiveAdmins = await tx.user.count({
                where: { isAdmin: true, inactive: false, NOT: { id: userId } },
              });
              if (otherActiveAdmins === 0) throw new LastAdminError();
              return write(tx);
            },
            { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
          )
        : await write(prisma);
    } catch (updateError) {
      if (updateError instanceof LastAdminError) {
        await createEnhancedActivityLog(prisma, req, {
          userId: actorId,
          action: 'USER_UPDATE_REJECTED',
          category: 'USER',
          severity: 'WARNING',
          metadata: { targetUserId: userId, reason: 'last-active-admin' },
        });
        if (avatarBuffer && avatarFilename) {
          await safeUnlinkInDir(pfpsDir, avatarFilename);
        }
        return NextResponse.json(
          { error: 'Cannot remove the last active administrator' },
          { status: 409 },
        );
      }
      if (
        updateError instanceof Prisma.PrismaClientKnownRequestError &&
        updateError.code === 'P2034'
      ) {
        if (avatarBuffer && avatarFilename) {
          await safeUnlinkInDir(pfpsDir, avatarFilename);
        }
        return NextResponse.json(
          { error: 'Another administrator change conflicted; please retry.' },
          { status: 409 },
        );
      }
      if (avatarBuffer && avatarFilename) {
        await safeUnlinkInDir(pfpsDir, avatarFilename);
      }
      // The unique email constraint is the real guard against a race between the
      // pre-check above and this write; surface it as the same friendly 409.
      if (
        emailToUpdate &&
        updateError &&
        typeof updateError === 'object' &&
        (updateError as { code?: string }).code === 'P2002'
      ) {
        return NextResponse.json({ error: 'That email is already in use' }, { status: 409 });
      }
      throw updateError;
    }

    // Commit succeeded: drop the previous file when it was replaced or cleared.
    if ((avatarBuffer || (deleteAvatar && avatarFilename === null)) && userRecord?.avatar) {
      await safeUnlinkInDir(pfpsDir, userRecord.avatar);
    }

    // This edit can flip isAdmin or inactive, so the cached session row must go now:
    // a de-admined or disabled account should not keep working until the TTL lapses.
    invalidateSessionUser(userId);

    // Record exactly what changed (before → after). Admin-flag and active-status
    // changes especially matter when an admin edits another account.
    const AUDITED_USER_FIELDS = [
      'firstName',
      'lastName',
      'email',
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
      category: 'USER',
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
 *   403: { description: "System administrators only (also returned when not signed in), or attempting to delete your own account." }
 *   500: { description: Server error. }
 */
export async function DELETE(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const userId = id;
  let actorId: string | null = null;

  try {
    const session = await auth();
    const currentUser = session?.user;

    if (!currentUser || !isAdmin(currentUser) || currentUser.inactive) {
      console.warn(`[DELETE] Forbidden: ${currentUser?.id} tried to delete user ${userId}`);
      await createEnhancedActivityLog(prisma, req, {
        userId: session?.user?.id ?? null,
        action: 'USER_DELETE_DENIED',
        category: 'USER',
        severity: 'SECURITY',
        metadata: { targetUserId: userId },
      });
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    actorId = currentUser.id;

    // No self-delete: it's irreversible, and since only active admins can reach
    // this route, blocking it also guarantees a delete can never remove the last
    // active admin (the deleter always remains).
    if (currentUser.id === userId) {
      await createEnhancedActivityLog(prisma, req, {
        userId: actorId,
        action: 'USER_DELETE_REJECTED',
        category: 'USER',
        severity: 'WARNING',
        metadata: { targetUserId: userId, reason: 'self-delete' },
      });
      return NextResponse.json({ error: 'You cannot delete your own account' }, { status: 403 });
    }

    // Capture the target's identity before the row is gone, for the audit + avatar cleanup.
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { avatar: true, email: true, firstName: true, lastName: true },
    });

    // Delete user from database. The user's activity logs are intentionally
    // preserved for the audit trail: the schema's onDelete: SetNull nulls their
    // userId, and each entry keeps the actor's name/email in metadata.
    await prisma.user.delete({
      where: { id: userId },
    });
    invalidateSessionUser(userId);

    /**
     * The avatar goes last, and only once the row is really gone.
     *
     * Removing the file first meant a failed delete left a live account whose photo had been
     * deleted out from under it: the account is broken and nothing says why. This way the
     * worst case is a file nobody references, which costs disk and no correctness. A failure
     * here is reported and not raised: the account is already gone, and turning cleanup into
     * an error would report a deletion that did happen as one that did not.
     */
    if (user?.avatar) {
      try {
        await safeUnlinkInDir(pfpsDir, user.avatar);
      } catch (cleanupError) {
        console.warn(
          `[DELETE] Deleted user ${userId} but could not remove their avatar:`,
          cleanupError,
        );
      }
    }

    // Log activity: record who was deleted, since the user row is now gone.
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
      category: 'USER',
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
