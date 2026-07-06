import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { BACKUP_DIR, isValidBackupName } from '@/lib/backups';

export async function GET(req: Request) {
  const session = await auth();
  const role = session?.user?.role;
  if (!role || !['ADMIN', 'FACULTY'].includes(role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const file = new URL(req.url).searchParams.get('file') ?? '';
  // Strict allow-list of exact backup filenames — also blocks path traversal.
  if (!isValidBackupName(file)) {
    return NextResponse.json({ error: 'Invalid backup file' }, { status: 400 });
  }

  const filePath = path.join(BACKUP_DIR, file);
  // Defense in depth: the resolved path must stay directly inside BACKUP_DIR.
  if (path.dirname(path.resolve(filePath)) !== path.resolve(BACKUP_DIR)) {
    return NextResponse.json({ error: 'Invalid backup file' }, { status: 400 });
  }

  let size: number;
  try {
    size = fs.statSync(filePath).size;
  } catch {
    return NextResponse.json({ error: 'Backup not found' }, { status: 404 });
  }

  // A dump is the entire database (password hashes, all PII) — always audit it.
  try {
    await createEnhancedActivityLog(prisma, req, {
      userId: session?.user?.id,
      action: 'SYSTEM_BACKUP_DOWNLOADED',
      severity: 'SECURITY',
      category: 'SYSTEM',
      metadata: { file },
    });
  } catch (err) {
    console.error('[backups] audit log failed:', err);
  }

  // Stream from disk so large archives aren't buffered into memory.
  const stream = Readable.toWeb(fs.createReadStream(filePath)) as ReadableStream<Uint8Array>;
  return new Response(stream, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${file}"`,
      'Content-Length': String(size),
    },
  });
}
