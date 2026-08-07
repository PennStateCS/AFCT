import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { reconcileUpdateOutcomeLog } from '@/lib/update-audit';
import { withAdminAuth } from '@/lib/api/with-auth';
import { apiError } from '@/lib/api/http';
import { readJson } from '@/lib/api/request';
import {
  currentVersion,
  fetchManifest,
  isValidTag,
  isValidRestorePoint,
  readRestorePoints,
  readStatus,
  updaterAvailable,
  updaterReadiness,
  updaterVersion,
  writeDeleteRestorePointRequest,
  writeDowngradeRequest,
  writeSelfUpdateRequest,
  writeUpdateRequest,
  withBackupDetails,
  type ReleaseVersion,
} from '@/lib/updates';
import { listBackups } from '@/lib/backups';

/**
 * Reports the deployed version, the available curated releases, and the latest
 * progress of any in-flight upgrade. System administrators only.
 * @openapi
 * summary: Get upgrade status and available versions
 * responses:
 *   200:
 *     description: Current version, available releases, and updater status.
 *     content:
 *       application/json:
 *         schema:
 *           type: object
 *           properties:
 *             current: { type: string }
 *             status: { type: object, nullable: true }
 *             versions: { type: array, items: { type: object } }
 *             manifestError: { type: boolean }
 *             updaterAvailable: { type: boolean }
 *             updaterReadiness:
 *               type: object
 *               nullable: true
 *               description: >
 *                 What the update service reports about its own configuration. Null when it
 *                 is too old to report, which is not an error.
 *               properties:
 *                 envFile: { type: string }
 *                 composeFile: { type: string }
 *                 envFileOk: { type: boolean }
 *                 composeFileOk: { type: boolean }
 *   403: { description: Caller is not a system administrator. }
 */
export const GET = withAdminAuth(
  async (req) => {
    let versions: ReleaseVersion[] = [];
    let manifestError = false;
    try {
      versions = (await fetchManifest()).versions;
    } catch {
      // The release list is fetched over the network; degrade gracefully so the
      // page still shows the current version and any in-flight status.
      manifestError = true;
    }
    // Ride along on the status poll to record a finished run's outcome in the activity
    // log exactly once. The updater has no DB access, so the app reconciles it here.
    await reconcileUpdateOutcomeLog(prisma, req);
    return NextResponse.json({
      current: currentVersion(),
      status: readStatus(),
      versions,
      manifestError,
      updaterAvailable: updaterAvailable(),
      updaterVersion: updaterVersion(),
      updaterReadiness: updaterReadiness(),
      // Enrich with each backup's size + encrypted flag, read from the same backup dir
      // the Backups tab lists, so the restore table can show them without the updater
      // recording anything extra.
      restorePoints: withBackupDetails(readRestorePoints(), listBackups()),
    });
  },
  { deniedAction: 'ADMIN_UPGRADE_VIEW_DENIED' },
);

const UpgradeBody = z.object({
  action: z.enum(['upgrade', 'downgrade', 'self-update', 'delete-restore-point']).optional(),
  // Required for every action except delete-restore-point, which only needs a
  // restorePoint; validated per-action below.
  tag: z.string().min(1).optional(),
  restorePoint: z.string().optional(),
  // Downgrade only: proceed even if the updater can't confirm a pre-downgrade safety
  // backup. The admin opts into this after the updater has already refused for that
  // reason, accepting that the current state cannot be restored afterward.
  force: z.boolean().optional(),
});

/**
 * Requests an application upgrade to a curated release by dropping a validated
 * request for the updater sidecar to perform. System administrators only. Returns
 * 202; the swap, health check, and rollback happen asynchronously in the sidecar.
 * Upgrade to a curated release, or DOWNGRADE by restoring a recorded pre-upgrade
 * backup (which permanently discards everything created since it). Returns 202.
 * @openapi
 * summary: Request an application upgrade or downgrade
 * requestBody:
 *   required: true
 *   content:
 *     application/json:
 *       schema:
 *         type: object
 *         properties:
 *           action: { type: string, enum: [upgrade, downgrade, self-update, delete-restore-point] }
 *           tag: { type: string }
 *           restorePoint: { type: string }
 *           force: { type: boolean, description: "Downgrade only: proceed without a confirmed pre-downgrade safety backup." }
 * responses:
 *   202:
 *     description: Requested; it will run asynchronously.
 *     content:
 *       application/json:
 *         schema:
 *           type: object
 *           properties: { ok: { type: boolean }, requestId: { type: string } }
 *   400: { description: "Invalid tag/restore point, an unknown release, or the current version." }
 *   403: { description: Caller is not a system administrator. }
 *   503: { description: The release list or the updater service is unavailable. }
 */
export const POST = withAdminAuth(
  async (req, _ctx, { user }) => {
    const parsed = await readJson(req, UpgradeBody);
    if (!parsed.ok) return parsed.response;
    const { action = 'upgrade', tag, restorePoint, force = false } = parsed.data;
    const requestId = crypto.randomUUID();

    // ---- Delete a restore point: remove an old backup the admin no longer wants to
    // keep. No tag or running container involved; only a recorded restore point.
    if (action === 'delete-restore-point') {
      if (!restorePoint || !isValidRestorePoint(restorePoint)) {
        return apiError(400, 'A valid restore point is required');
      }
      const match = readRestorePoints().find((r) => r.backup === restorePoint);
      if (!match) {
        return apiError(400, `No restore point ${restorePoint}`);
      }
      try {
        writeDeleteRestorePointRequest({ restorePoint, requestedBy: user.id, requestId });
      } catch {
        return apiError(503, 'The updater service is not available');
      }
      try {
        await createEnhancedActivityLog(prisma, req, {
          userId: user.id,
          action: 'SYSTEM_RESTORE_POINT_DELETE_REQUESTED',
          severity: 'WARNING',
          category: 'SYSTEM',
          metadata: { restorePoint, version: match.version, requestId },
        });
      } catch (err) {
        console.error('[updates] audit log failed:', err);
      }
      return NextResponse.json({ ok: true, requestId }, { status: 202 });
    }

    if (!tag || !isValidTag(tag)) {
      return apiError(400, 'Invalid version tag');
    }

    // ---- Self-update: recreate the updater sidecar itself so it stops lagging the
    // app version. The target is the running app version; the updater re-checks it.
    if (action === 'self-update') {
      if (tag !== currentVersion()) {
        return apiError(400, 'The update service can only be updated to the running version');
      }
      try {
        writeSelfUpdateRequest({ tag, requestedBy: user.id, requestId });
      } catch {
        return apiError(503, 'The updater service is not available');
      }
      try {
        await createEnhancedActivityLog(prisma, req, {
          userId: user.id,
          action: 'SYSTEM_UPDATER_SELF_UPDATE_REQUESTED',
          severity: 'INFO',
          category: 'SYSTEM',
          metadata: { tag, requestId },
        });
      } catch (err) {
        console.error('[updates] audit log failed:', err);
      }
      return NextResponse.json({ ok: true, requestId }, { status: 202 });
    }

    // ---- Downgrade: restore a recorded pre-upgrade backup and run the old image.
    if (action === 'downgrade') {
      if (!restorePoint || !isValidRestorePoint(restorePoint)) {
        return apiError(400, 'A valid restore point is required to downgrade');
      }
      // The (version, restorePoint) pair must be one the updater actually recorded.
      const match = readRestorePoints().find((r) => r.version === tag && r.backup === restorePoint);
      if (!match) {
        return apiError(400, `No restore point ${restorePoint} for ${tag}`);
      }
      if (tag === currentVersion()) {
        return apiError(400, `AFCT is already running ${tag}`);
      }
      try {
        writeDowngradeRequest({ tag, restorePoint, requestedBy: user.id, requestId, force });
      } catch {
        return apiError(503, 'The updater service is not available');
      }
      try {
        await createEnhancedActivityLog(prisma, req, {
          userId: user.id,
          action: 'SYSTEM_DOWNGRADE_REQUESTED',
          severity: 'WARNING',
          category: 'SYSTEM',
          // `forced` records that the admin proceeded without a confirmed safety backup,
          // which is the more consequential path and worth having in the audit trail.
          metadata: { tag, restorePoint, requestId, fromTag: currentVersion(), forced: force },
        });
      } catch (err) {
        console.error('[updates] audit log failed:', err);
      }
      return NextResponse.json({ ok: true, requestId }, { status: 202 });
    }

    // ---- Upgrade: the target must be a curated release (the updater re-checks this).
    let versions: ReleaseVersion[];
    try {
      versions = (await fetchManifest()).versions;
    } catch {
      return apiError(503, 'Could not verify the available versions right now');
    }
    if (!versions.some((v) => v.tag === tag)) {
      return apiError(400, `Version ${tag} is not an available release`);
    }

    if (tag === currentVersion()) {
      return apiError(400, `AFCT is already running ${tag}`);
    }

    try {
      writeUpdateRequest({ tag, requestedBy: user.id, requestId });
    } catch {
      return apiError(503, 'The updater service is not available');
    }

    try {
      await createEnhancedActivityLog(prisma, req, {
        userId: user.id,
        action: 'SYSTEM_UPDATE_REQUESTED',
        severity: 'INFO',
        category: 'SYSTEM',
        metadata: { tag, requestId, fromTag: currentVersion() },
      });
    } catch (err) {
      console.error('[updates] audit log failed:', err);
    }

    return NextResponse.json({ ok: true, requestId }, { status: 202 });
  },
  { deniedAction: 'ADMIN_UPGRADE_TRIGGER_DENIED' },
);
