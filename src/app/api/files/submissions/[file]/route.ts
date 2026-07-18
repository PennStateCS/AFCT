import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { canManageCourse } from '@/lib/permissions';
import { apiError } from '@/lib/api/http';
import { logDenial, logError } from '@/lib/api/activity';
import { isSafeUploadName, serveUploadedFile } from '@/lib/api/serve-file';

/**
 * Serves a submission's uploaded file as a download. Restricted to the submitting
 * student, course staff (faculty or TAs), or a system admin. The download is audited,
 * and traversal filenames are rejected.
 * @openapi
 * summary: Get a submission file
 * parameters:
 *   - { name: file, in: path, required: true, schema: { type: string } }
 * responses:
 *   200:
 *     description: The file bytes (as an attachment).
 *     content:
 *       application/octet-stream:
 *         schema: { type: string, format: binary }
 *   400: { description: Invalid filename. }
 *   401: { description: Not signed in. }
 *   403: { description: "Not the submitting student, course staff, or a system admin." }
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

    const submission = await prisma.submission.findFirst({
      where: { fileName: file },
      select: {
        id: true,
        originalFileName: true,
        studentId: true,
        assignmentId: true,
        courseId: true,
      },
    });

    if (!submission) {
      return apiError(404, 'File not found');
    }

    // The owning student may fetch their own file; otherwise the caller must be
    // staff (faculty/TA) of the submission's course, or a global admin.
    const allowed =
      submission.studentId === session.user.id ||
      (await canManageCourse(session.user, submission.courseId));

    if (!allowed) {
      return logDenial(req, {
        userId: session.user.id,
        action: 'SUBMISSION_FILE_DOWNLOAD_DENIED',
        category: 'SUBMISSION',
        courseId: submission.courseId,
      });
    }

    return await serveUploadedFile(file, 'submissions', {
      disposition: 'attachment',
      downloadName: submission.originalFileName ?? file,
      onServe: () =>
        createEnhancedActivityLog(prisma, req, {
          userId: session.user.id,
          action: 'DOWNLOAD_SUBMISSION_FILE',
          severity: 'INFO',
          category: 'SUBMISSION',
          courseId: submission.courseId,
          assignmentId: submission.assignmentId,
          submissionId: submission.id,
          metadata: {
            fileName: file,
            originalFileName: submission.originalFileName ?? null,
            studentId: submission.studentId,
          },
        }),
    });
  } catch (err) {
    console.error('Error serving submission file:', err);
    await logError(req, {
      userId: actorId,
      action: 'SUBMISSION_FILE_DOWNLOAD_ERROR',
      category: 'SUBMISSION',
      error: err,
      metadata: { fileName: fileName ?? null },
    });
    return apiError(500, 'Internal server error');
  }
}
