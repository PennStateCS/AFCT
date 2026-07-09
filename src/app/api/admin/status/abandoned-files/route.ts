import { NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import { prisma } from '@/lib/prisma';
import { withAdminAuth } from '@/lib/api/with-auth';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';

const CATEGORY_FOLDERS: Record<string, string> = {
  solutions: 'solutions',
  submissions: 'submissions',
  pfps: 'pfps',
  problems: 'problems',
};

// Reject anything that could escape the category folder (traversal or separators).
const isSafeFileName = (name: string) => {
  if (!name) return false;
  if (name.includes('..')) return false;
  if (name.includes('/') || name.includes('\\')) return false;
  return true;
};

/**
 * Deletes a single orphaned upload — a file on disk that no DB row references
 * (see the abandoned-file report on the status dashboard). System administrators
 * only. Guards on every axis: the category must be known, the name
 * must be separator-free, the file must still be unreferenced, and the resolved
 * path must stay inside its category folder.
 * @openapi
 * summary: Delete an orphaned upload
 * requestBody:
 *   required: true
 *   content:
 *     application/json:
 *       schema:
 *         type: object
 *         required: [category, fileName]
 *         properties:
 *           category: { type: string, enum: [solutions, submissions, pfps, problems] }
 *           fileName: { type: string, description: "Bare filename, no path separators" }
 * responses:
 *   200:
 *     description: File deleted.
 *     content:
 *       application/json:
 *         schema: { type: object, properties: { ok: { type: boolean } } }
 *   400: { description: "Unknown category, unsafe filename, or path outside the category folder." }
 *   401: { description: Not signed in. }
 *   403: { description: Caller is not a system administrator. }
 *   404: { description: File not found on disk. }
 *   409: { description: A DB row still references this file — refused. }
 *   500: { description: Server error. }
 */
export const DELETE = withAdminAuth(
  async (req, _ctx, { user }) => {
    const actorId = user.id;
    try {
      const body = (await req.json().catch(() => null)) as {
        category?: string;
        fileName?: string;
      } | null;
      const category = body?.category?.trim();
      const fileName = body?.fileName?.trim();

      if (!category || !fileName || !CATEGORY_FOLDERS[category] || !isSafeFileName(fileName)) {
        return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
      }

      if (category === 'solutions' || category === 'problems') {
        const existing = await prisma.problem.findFirst({ where: { fileName } });
        if (existing) {
          return NextResponse.json({ error: 'File is still referenced' }, { status: 409 });
        }
      } else if (category === 'submissions') {
        const existing = await prisma.submission.findFirst({ where: { fileName } });
        if (existing) {
          return NextResponse.json({ error: 'File is still referenced' }, { status: 409 });
        }
      } else if (category === 'pfps') {
        const existing = await prisma.user.findFirst({ where: { avatar: fileName } });
        if (existing) {
          return NextResponse.json({ error: 'File is still referenced' }, { status: 409 });
        }
      }

      const uploadsRoot = path.join('/private', 'uploads');
      const folder = CATEGORY_FOLDERS[category];
      const baseDir = path.join(uploadsRoot, folder);
      const filePath = path.join(baseDir, fileName);
      const resolvedBase = path.resolve(baseDir);
      const resolvedFile = path.resolve(filePath);

      if (!resolvedFile.startsWith(resolvedBase)) {
        return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
      }

      if (!fs.existsSync(resolvedFile)) {
        return NextResponse.json({ error: 'File not found' }, { status: 404 });
      }

      await fs.promises.unlink(resolvedFile);

      await createEnhancedActivityLog(prisma, req, {
        userId: actorId,
        action: 'ABANDONED_FILE_DELETED',
        severity: 'INFO',
        category: 'SYSTEM',
        metadata: { userId: actorId, category, fileName },
      });

      return NextResponse.json({ ok: true });
    } catch (err) {
      console.error('Delete abandoned file error:', err);
      await createEnhancedActivityLog(prisma, req, {
        userId: actorId,
        action: 'ABANDONED_FILES_DELETE_ERROR',
        severity: 'ERROR',
        metadata: { error: err instanceof Error ? err.message : 'unknown error' },
      });
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
  },
  { deniedAction: 'ABANDONED_FILES_DELETE_DENIED' },
);
