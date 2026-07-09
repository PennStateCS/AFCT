import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { prisma } from '@/lib/prisma';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { withAdminAuth } from '@/lib/api/with-auth';
import { BACKUP_DIR, isValidBackupName } from '@/lib/backups';

/**
 * Streams a single backup file to the caller as an attachment. System administrators only.
 * A database dump contains the entire database (password hashes and all PII), so
 * the download is always recorded as a SECURITY audit event. The filename is
 * checked against a strict allow-list and the resolved path must stay inside the
 * backup directory — two independent guards against path traversal.
 * @openapi
 * summary: Download a backup file
 * parameters:
 *   - name: file
 *     in: query
 *     required: true
 *     description: Exact backup filename from the list endpoint.
 *     schema: { type: string }
 * responses:
 *   200:
 *     description: The backup file as an octet-stream attachment.
 *     content:
 *       application/octet-stream:
 *         schema: { type: string, format: binary }
 *   400: { description: Filename failed the allow-list or path check. }
 *   403: { description: Caller is not a system administrator. }
 *   404: { description: The backup file does not exist. }
 */
export const GET = withAdminAuth(
  async (req, _ctx, { user }) => {
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
        userId: user.id,
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
  },
  { deniedAction: 'ADMIN_BACKUP_DOWNLOAD_DENIED' },
);
