import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { canAccessCourse, canManageCourse, canViewStudentData } from '@/lib/permissions';
import { resolveStudentContentGate } from '@/lib/assignment-student-gate';
import { apiError } from '@/lib/api/http';
import { logDenial, logError } from '@/lib/api/activity';
import { isSafeUploadName, serveUploadedFile } from '@/lib/api/serve-file';

/**
 * Serves a submission's uploaded file. Restricted to the submitting student, anyone in the
 * group that owns the work, course staff (faculty or TAs), or a system admin. Every successful
 * serve is audited, as a view by default and as a download when `?download=1` is set.
 * Traversal filenames are rejected.
 * @openapi
 * summary: Get a submission file
 * parameters:
 *   - { name: file, in: path, required: true, schema: { type: string } }
 *   - name: download
 *     in: query
 *     required: false
 *     description: Set to `1` to audit the serve as a download rather than an inline view.
 *     schema: { type: string, enum: ['1'] }
 * responses:
 *   200:
 *     description: The file bytes (as an attachment).
 *     content:
 *       application/octet-stream:
 *         schema: { type: string, format: binary }
 *   400: { description: Invalid filename. }
 *   401: { description: Not signed in. }
 *   403: { description: "Not the submitting student, a member of the group that owns the work, course staff, or a system admin." }
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
        // Group work belongs to the group, not to whoever happened to upload it. Without this
        // the rule below could only ever recognise the uploader, so a groupmate looking at the
        // shared attempt AFCT had already shown them was refused the file itself.
        studentGroupId: true,
        assignmentId: true,
        courseId: true,
      },
    });

    if (!submission) {
      return apiError(404, 'File not found');
    }

    /**
     * Course access first, then whose work.
     *
     * `canViewStudentData` decides the second question only, and says so: it assumes course
     * membership has already been gated, normally by `withCourseAuth`. This route cannot use
     * that wrapper, because the path names a file rather than a course, so the gate has to be
     * here. Without it a dropped student still reads their own work and their old group's,
     * since dropping keeps the roster row and every group membership on purpose and denies
     * access through this one function instead.
     */
    const allowed =
      (await canAccessCourse(session.user, submission.courseId)) &&
      // The one rule for "whose work may this person read", shared with the desktop client's
      // submission route so the two paths cannot answer differently: the student themselves,
      // a member of the group that owns the work, course staff, or a system admin. The group
      // check is scoped to the owning group, never "shares any group in this course".
      (await canViewStudentData(session.user, submission.courseId, submission.studentId, {
        studentGroupId: submission.studentGroupId,
      }));

    /**
     * For a student, the same audience and unlock gate the assignment's own reads run.
     *
     * Course access and ownership were as far as this went, so a student taken out of an
     * assignment's audience, or one whose assignment was put back behind an unlock time, could
     * still fetch the bytes directly while every other surface had stopped showing them. Staff
     * skip it: they set the audience, and they read everybody's work by design.
     */
    const gated =
      allowed &&
      (await (async () => {
        if (await canManageCourse(session.user, submission.courseId)) return true;
        const gate = await resolveStudentContentGate(submission.assignmentId, session.user.id);
        return gate.assigned && !gate.locked;
      })());

    if (!gated) {
      return logDenial(req, {
        userId: session.user.id,
        action: 'SUBMISSION_FILE_ACCESS_DENIED',
        category: 'SUBMISSION',
        courseId: submission.courseId,
        // The subject here is whose file was reached for, which is not the actor.
        metadata: {
          reason:
            'no access to the course or the assignment, or not the owning student, a member of the owning group, or course staff',
          targetUserId: submission.studentId,
          submissionId: submission.id,
        },
      });
    }

    // Distinguish an inline view (the in-app viewer fetches the bytes to render the
    // automaton) from an explicit ?download=1 download. Both are disclosures of a
    // student's work and both are logged, but they are different access events, and
    // recording every view as a download misstates what the reader actually did.
    const isDownload = new URL(req.url).searchParams.get('download') === '1';

    return await serveUploadedFile(file, 'submissions', {
      disposition: 'attachment',
      downloadName: submission.originalFileName ?? file,
      onServe: () =>
        createEnhancedActivityLog(prisma, req, {
          userId: session.user.id,
          action: isDownload ? 'DOWNLOAD_SUBMISSION_FILE' : 'VIEW_SUBMISSION_FILE',
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
      action: 'SUBMISSION_FILE_ACCESS_ERROR',
      category: 'SUBMISSION',
      error: err,
      metadata: { fileName: fileName ?? null },
    });
    return apiError(500, 'Internal server error');
  }
}
