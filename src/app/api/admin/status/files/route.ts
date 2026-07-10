import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withAdminAuth } from '@/lib/api/with-auth';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { logError } from '@/lib/api/activity';
import { collectAbandonedFiles, deleteAbandonedFile } from '@/lib/status/files';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Files tab: report of orphaned uploads — files on disk that no DB row
 * references, by category, with up to 50 samples. System administrators only.
 * @openapi
 * summary: Abandoned-file report
 * responses:
 *   200: { description: Orphaned-upload counts and samples. }
 *   401: { description: Not signed in. }
 *   403: { description: Not a system administrator. }
 */
export const GET = withAdminAuth(
  async () => {
    const data = await collectAbandonedFiles();
    return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
  },
  { deniedAction: 'ADMIN_STATUS_ACCESS_DENIED' },
);

/**
 * Deletes a single orphaned upload. Guards on every axis (known category,
 * separator-free name, still unreferenced, path stays inside the category
 * folder). System administrators only.
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
 *   200: { description: File deleted. }
 *   400: { description: "Unknown category, unsafe filename, or path outside the folder." }
 *   401: { description: Not signed in. }
 *   403: { description: Not a system administrator. }
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

      const result = await deleteAbandonedFile(body?.category, body?.fileName);
      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: result.status });
      }

      await createEnhancedActivityLog(prisma, req, {
        userId: actorId,
        action: 'ABANDONED_FILE_DELETED',
        severity: 'INFO',
        category: 'SYSTEM',
        metadata: { userId: actorId, category: body?.category, fileName: body?.fileName },
      });

      return NextResponse.json({ ok: true });
    } catch (err) {
      console.error('Delete abandoned file error:', err);
      await logError(req, {
        userId: actorId,
        action: 'ABANDONED_FILES_DELETE_ERROR',
        error: err,
      });
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
  },
  { deniedAction: 'ABANDONED_FILES_DELETE_DENIED' },
);
