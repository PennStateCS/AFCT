import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { canManageCourse } from '@/lib/permissions';
import { apiError } from '@/lib/api/http';
import { logDenial, logError } from '@/lib/api/activity';
import { isSafeUploadName, serveUploadedFile } from '@/lib/api/serve-file';

/**
 * Serves a problem's solution file, the most sensitive protected material, so
 * access is limited to course staff (faculty or TAs) or a system admin, and every
 * successful serve is audited (both inline and `?download=1`). Traversal filenames
 * are rejected.
 * @openapi
 * summary: Get a solution file
 * parameters:
 *   - { name: file, in: path, required: true, schema: { type: string } }
 *   - { name: download, in: query, description: Set to "1" to mark the access as a download in the audit log, schema: { type: string, enum: ['1'] } }
 * responses:
 *   200:
 *     description: The solution file bytes (as an attachment).
 *     content:
 *       application/octet-stream:
 *         schema: { type: string, format: binary }
 *   400: { description: Invalid filename. }
 *   401: { description: Not signed in. }
 *   403: { description: Caller is not course staff or a system admin. }
 *   404: { description: File not found. }
 *   500: { description: Server error. }
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ file: string }> }) {
  let actorId: string | null = null;
  let fileName: string | undefined;
  try {
    const resolvedParams = await params;
    const { file } = resolvedParams;
    fileName = file;
    if (!isSafeUploadName(file)) {
      return apiError(400, 'Invalid file');
    }

    // Require authenticated user
    const session = await auth();
    actorId = session?.user?.id ?? null;
    if (!session?.user?.id || session.user.inactive) {
      return apiError(401, 'Unauthorized');
    }

    // Find the problem record by stored filename so we can return the original name and course
    const problem = await prisma.problem.findFirst({ where: { fileName: file } });
    if (!problem) {
      return apiError(404, 'File not found');
    }

    // Allow access only for course staff (faculty/TA) or a global admin.
    if (!(await canManageCourse(session.user, problem.courseId))) {
      return logDenial(req, {
        userId: session.user.id,
        action: 'SOLUTION_DOWNLOAD_DENIED',
        category: 'PROBLEM',
        courseId: problem.courseId,
      });
    }

    // Solutions are the most sensitive protected material, so log every successful
    // serve (not only the explicit ?download=1 variant).
    const mode = req.nextUrl.searchParams.get('download') === '1' ? 'download' : 'inline';
    return await serveUploadedFile(file, 'solutions', {
      disposition: 'attachment',
      downloadName: problem.originalFileName ?? file,
      onServe: () =>
        createEnhancedActivityLog(prisma, req, {
          userId: session.user.id,
          action: 'DOWNLOAD_SOLUTION_FILE',
          severity: 'INFO',
          category: 'PROBLEM',
          courseId: problem.courseId,
          problemId: problem.id,
          metadata: {
            fileName: file,
            originalFileName: problem.originalFileName ?? null,
            mode,
          },
        }),
    });
  } catch (err) {
    console.error('Error serving solution file:', err);
    await logError(req, {
      userId: actorId,
      action: 'SOLUTION_DOWNLOAD_ERROR',
      error: err,
      category: 'PROBLEM',
      metadata: { fileName: fileName ?? null },
    });
    return apiError(500, 'Internal server error');
  }
}
