import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { canManageCourse } from '@/lib/permissions';
import { apiError } from '@/lib/api/http';
import { logDenial, logError } from '@/lib/api/activity';
import { isSafeUploadName, serveUploadedFile } from '@/lib/api/serve-file';

/**
 * Serves a problem's attached file, inline. **Course staff (faculty/TA) or a system
 * admin only**: a problem file is the autograder's answer/solution key, so a student
 * must never receive it (same sensitivity as a solution file). The download is audited,
 * and traversal filenames are rejected.
 * @openapi
 * summary: Get a problem file
 * parameters:
 *   - { name: file, in: path, required: true, schema: { type: string } }
 * responses:
 *   200:
 *     description: The file bytes (inline).
 *     content:
 *       application/octet-stream:
 *         schema: { type: string, format: binary }
 *   400: { description: Invalid filename. }
 *   401: { description: Not signed in. }
 *   403: { description: Caller is not course staff or a system admin. }
 *   404: { description: File not found. }
 *   500: { description: Server error. }
 */
export async function GET(req: Request, { params }: { params: Promise<{ file: string }> }) {
  let actorId: string | null = null;
  let fileName: string | undefined;
  try {
    const { file } = await params;
    fileName = file;
    if (!isSafeUploadName(file)) {
      return apiError(400, 'Invalid file');
    }

    const session = await auth();
    actorId = session?.user?.id ?? null;
    if (!session?.user?.id || session.user.inactive) {
      return apiError(401, 'Unauthorized');
    }

    const problem = await prisma.problem.findFirst({ where: { fileName: file } });
    if (!problem) {
      return apiError(404, 'File not found');
    }

    // Staff-only: a problem file is the autograder's answer/solution key, so only
    // course staff (faculty/TA) or a global admin may fetch it, never a student.
    if (!(await canManageCourse(session.user, problem.courseId))) {
      return logDenial(req, {
        userId: session.user.id,
        action: 'PROBLEM_FILE_DOWNLOAD_DENIED',
        category: 'PROBLEM',
        courseId: problem.courseId,
      });
    }

    return await serveUploadedFile(file, 'problems', {
      downloadName: problem.originalFileName ?? file,
      onServe: () =>
        createEnhancedActivityLog(prisma, req, {
          userId: session.user.id,
          action: 'DOWNLOAD_PROBLEM_FILE',
          severity: 'INFO',
          category: 'PROBLEM',
          courseId: problem.courseId,
          problemId: problem.id,
          metadata: {
            fileName: file,
            originalFileName: problem.originalFileName ?? null,
          },
        }),
    });
  } catch (err) {
    console.error('Error serving problem file:', err);
    await logError(req, {
      userId: actorId,
      action: 'PROBLEM_FILE_DOWNLOAD_ERROR',
      category: 'PROBLEM',
      error: err,
      metadata: { fileName: fileName ?? null },
    });
    return apiError(500, 'Internal server error');
  }
}
