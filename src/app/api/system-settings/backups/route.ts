import { NextResponse } from 'next/server';
import fs from 'fs';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { listBackups, BACKUP_TRIGGER_DIR, BACKUP_TRIGGER_FILE } from '@/lib/backups';

function authorized(role: string | undefined): boolean {
  return !!role && ['ADMIN', 'FACULTY'].includes(role);
}

// List available backups (newest first), paired as { database dump, files archive }.
export async function GET() {
  const session = await auth();
  if (!authorized(session?.user?.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }
  return NextResponse.json({ backups: listBackups() });
}

// Request an on-demand backup: drop a flag the db-backup container watches for.
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
