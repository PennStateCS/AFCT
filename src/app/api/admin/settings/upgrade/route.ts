import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
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
  writeDowngradeRequest,
  writeUpdateRequest,
  type ReleaseVersion,
} from '@/lib/updates';

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
 *   403: { description: Caller is not a system administrator. }
 */
export const GET = withAdminAuth(
  async () => {
    let versions: ReleaseVersion[] = [];
    let manifestError = false;
    try {
      versions = (await fetchManifest()).versions;
    } catch {
      // The release list is fetched over the network; degrade gracefully so the
      // page still shows the current version and any in-flight status.
      manifestError = true;
    }
    return NextResponse.json({
      current: currentVersion(),
      status: readStatus(),
      versions,
      manifestError,
      restorePoints: readRestorePoints(),
    });
  },
  { deniedAction: 'ADMIN_UPGRADE_VIEW_DENIED' },
);

const UpgradeBody = z.object({
  action: z.enum(['upgrade', 'downgrade']).optional(),
  tag: z.string().min(1),
  restorePoint: z.string().optional(),
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
 *         required: [tag]
 *         properties:
 *           action: { type: string, enum: [upgrade, downgrade] }
 *           tag: { type: string }
 *           restorePoint: { type: string }
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
    const { action = 'upgrade', tag, restorePoint } = parsed.data;

    if (!isValidTag(tag)) {
      return apiError(400, 'Invalid version tag');
    }

    const requestId = crypto.randomUUID();

    // ---- Downgrade: restore a recorded pre-upgrade backup and run the old image.
    if (action === 'downgrade') {
      if (!restorePoint || !isValidRestorePoint(restorePoint)) {
        return apiError(400, 'A valid restore point is required to downgrade');
      }
      // The (version, restorePoint) pair must be one the updater actually recorded.
      const match = readRestorePoints().find(
        (r) => r.version === tag && r.backup === restorePoint,
      );
      if (!match) {
        return apiError(400, `No restore point ${restorePoint} for ${tag}`);
      }
      if (tag === currentVersion()) {
        return apiError(400, `AFCT is already running ${tag}`);
      }
      try {
        writeDowngradeRequest({ tag, restorePoint, requestedBy: user.id, requestId });
      } catch {
        return apiError(503, 'The updater service is not available');
      }
      try {
        await createEnhancedActivityLog(prisma, req, {
          userId: user.id,
          action: 'SYSTEM_DOWNGRADE_REQUESTED',
          severity: 'WARNING',
          category: 'SYSTEM',
          metadata: { tag, restorePoint, requestId, fromTag: currentVersion() },
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
