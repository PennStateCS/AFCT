import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { withAdminAuth } from '@/lib/api/with-auth';
import { statusGet } from '@/lib/api/status-route';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { logError } from '@/lib/api/activity';
import { readJson } from '@/lib/api/request';
import {
  collectAbandonedFiles,
  deleteAbandonedFile,
  deleteAbandonedFilesInCategory,
} from '@/lib/status/files';

// Light shape check; the two delete helpers do the authoritative category/filename/
// path validation and return their own status codes.
const DeleteAbandonedFileBody = z.object({
  category: z.string().optional(),
  fileName: z.string().optional(),
  /** Delete every abandoned file in the category rather than one named file. */
  all: z.boolean().optional(),
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Files tab: report of orphaned uploads, files on disk that no DB row
 * references, by category, with up to 50 samples. System administrators only.
 * @openapi
 * summary: Abandoned-file report
 * responses:
 *   200: { description: Orphaned-upload counts and samples. }
 *   401: { description: Not signed in. }
 *   403: { description: Not a system administrator. }
 */
export const GET = statusGet(collectAbandonedFiles);

/**
 * Deletes one orphaned upload, or every orphaned upload in a category when `all` is
 * set. Guards on every axis (known category, separator-free name, still unreferenced,
 * path stays inside the category folder). System administrators only.
 * @openapi
 * summary: Delete an orphaned upload
 * requestBody:
 *   required: true
 *   content:
 *     application/json:
 *       schema:
 *         type: object
 *         required: [category]
 *         properties:
 *           category: { type: string, enum: [solutions, submissions, pfps, problems, trials] }
 *           fileName: { type: string, description: "Bare filename, no path separators" }
 *           all: { type: boolean, description: "Delete every abandoned file in the category" }
 * responses:
 *   200: { description: "File deleted, or the number deleted when clearing a category." }
 *   400: { description: "Unknown category, unsafe filename, or path outside the folder." }
 *   401: { description: Not signed in. }
 *   403: { description: Not a system administrator. }
 *   404: { description: File not found on disk. }
 *   409: { description: A DB row still references this file; refused. }
 *   500: { description: Server error. }
 */
export const DELETE = withAdminAuth(
  async (req, _ctx, { user }) => {
    const actorId = user.id;
    try {
      const parsed = await readJson(req, DeleteAbandonedFileBody);
      if (!parsed.ok) return parsed.response;
      const { category, fileName, all } = parsed.data;

      if (all) {
        const result = await deleteAbandonedFilesInCategory(category);
        if (!result.ok) {
          return NextResponse.json({ error: result.error }, { status: result.status });
        }

        // Logged at WARNING, unlike a single delete: this removes an unbounded number of
        // files in one action and cannot be undone, so it should stand out in the log rather
        // than sit among routine entries.
        await createEnhancedActivityLog(prisma, req, {
          userId: actorId,
          action: 'ABANDONED_FILES_PURGED',
          severity: 'WARNING',
          category: 'SYSTEM',
          metadata: {
            userId: actorId,
            category,
            deleted: result.deleted,
            freedBytes: result.freedBytes,
          },
        });

        return NextResponse.json({
          ok: true,
          deleted: result.deleted,
          freedBytes: result.freedBytes,
        });
      }

      const result = await deleteAbandonedFile(category, fileName);
      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: result.status });
      }

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
      await logError(req, {
        userId: actorId,
        action: 'ABANDONED_FILES_DELETE_ERROR',
        category: 'SYSTEM',
        error: err,
      });
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
  },
  { deniedAction: 'ABANDONED_FILES_DELETE_DENIED' },
);
