import { NextResponse } from 'next/server';
import fs from 'fs';
import { prisma } from '@/lib/prisma';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { withAdminAuth } from '@/lib/api/with-auth';
import { listBackups, BACKUP_TRIGGER_DIR, BACKUP_TRIGGER_FILE } from '@/lib/backups';

/**
 * Lists available backups, newest first, each pairing a database dump with its
 * matching upload-files archive. System administrators only.
 * @openapi
 * summary: List backups
 * responses:
 *   200:
 *     description: The available backup pairs.
 *     content:
 *       application/json:
 *         schema:
 *           type: object
 *           properties:
 *             backups: { type: array, items: { type: object } }
 *   403: { description: Caller is not a system administrator. }
 */
export const GET = withAdminAuth(() => NextResponse.json({ backups: listBackups() }), {
  deniedAction: 'ADMIN_BACKUPS_VIEW_DENIED',
});

/**
 * Requests an on-demand backup by dropping a trigger file the db-backup container
 * polls for. System administrators only. Returns 202 (accepted) — the backup runs
 * asynchronously in that container, not in this request.
 * @openapi
 * summary: Trigger a backup now
 * responses:
 *   202:
 *     description: Backup requested; it will run asynchronously.
 *     content:
 *       application/json:
 *         schema: { type: object, properties: { ok: { type: boolean } } }
 *   403: { description: Caller is not a system administrator. }
 *   503: { description: The backup service (trigger volume) is not mounted. }
 */
export const POST = withAdminAuth(
  async (req, _ctx, { user }) => {
    try {
      fs.mkdirSync(BACKUP_TRIGGER_DIR, { recursive: true });
      fs.writeFileSync(BACKUP_TRIGGER_FILE, new Date().toISOString());
    } catch {
      // Trigger volume isn't mounted (e.g. local dev without the backup service).
      return NextResponse.json({ error: 'Backup service is not available' }, { status: 503 });
    }

    try {
      await createEnhancedActivityLog(prisma, req, {
        userId: user.id,
        action: 'SYSTEM_BACKUP_REQUESTED',
        severity: 'INFO',
        category: 'SYSTEM',
        metadata: {},
      });
    } catch (err) {
      console.error('[backups] audit log failed:', err);
    }

    return NextResponse.json({ ok: true }, { status: 202 });
  },
  { deniedAction: 'ADMIN_BACKUP_TRIGGER_DENIED' },
);
