import { NextResponse } from 'next/server';
import fs from 'fs';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { listBackups, BACKUP_TRIGGER_DIR, BACKUP_TRIGGER_FILE } from '@/lib/backups';

function authorized(role: string | undefined): boolean {
  return !!role && ['ADMIN', 'FACULTY'].includes(role);
}

/**
 * Lists available backups, newest first, each pairing a database dump with its
 * matching upload-files archive. Admin/Faculty only.
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
 *   403: { description: Caller is not an admin or faculty user. }
 */
export async function GET() {
  const session = await auth();
  if (!authorized(session?.user?.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }
  return NextResponse.json({ backups: listBackups() });
}

/**
 * Requests an on-demand backup by dropping a trigger file the db-backup container
 * polls for. Admin/Faculty only. Returns 202 (accepted) — the backup runs
 * asynchronously in that container, not in this request.
 * @openapi
 * summary: Trigger a backup now
 * responses:
 *   202:
 *     description: Backup requested; it will run asynchronously.
 *     content:
 *       application/json:
 *         schema: { type: object, properties: { ok: { type: boolean } } }
 *   403: { description: Caller is not an admin or faculty user. }
 *   503: { description: The backup service (trigger volume) is not mounted. }
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!authorized(session?.user?.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  try {
    fs.mkdirSync(BACKUP_TRIGGER_DIR, { recursive: true });
    fs.writeFileSync(BACKUP_TRIGGER_FILE, new Date().toISOString());
  } catch {
    // Trigger volume isn't mounted (e.g. local dev without the backup service).
    return NextResponse.json({ error: 'Backup service is not available' }, { status: 503 });
  }

  try {
    await createEnhancedActivityLog(prisma, req, {
      userId: session?.user?.id,
      action: 'SYSTEM_BACKUP_REQUESTED',
      severity: 'INFO',
      category: 'SYSTEM',
      metadata: {},
    });
  } catch (err) {
    console.error('[backups] audit log failed:', err);
  }

  return NextResponse.json({ ok: true }, { status: 202 });
}
