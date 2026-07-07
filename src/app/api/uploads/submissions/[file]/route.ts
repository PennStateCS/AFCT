import { NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { canManageCourse } from '@/lib/permissions';

/**
 * Serves a submission's uploaded file as a download. Restricted to the submitting
 * student and to staff (ADMIN/FACULTY/TA). The download is audited, and traversal
 * filenames are rejected.
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
 *   403: { description: Not the submitting student and not staff. }
 *   404: { description: File not found. }
 *   500: { description: Server error. }
 */
export async function GET(req: Request, { params }: { params: Promise<{ file: string }> }) {
  let actorId: string | null = null;
  let fileName: string | undefined;
  try {
    const { file } = await params;
    fileName = file;
    if (!file || file.includes('..')) {
      return NextResponse.json({ error: 'Invalid file' }, { status: 400 });
    }

    const session = await auth();
    actorId = session?.user?.id ?? null;
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const submission = await prisma.submission.findFirst({
      where: { fileName: file },
      select: { id: true, originalFileName: true, studentId: true, assignmentId: true, courseId: true },
    });

    if (!submission) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    // The owning student may fetch their own file; otherwise the caller must be
    // staff (faculty/TA) of the submission's course, or a global admin.
    let allowed = false;
    if (submission.studentId === session.user.id) allowed = true;
    else if (await canManageCourse(session.user, submission.courseId)) allowed = true;

    if (!allowed) {
      await createEnhancedActivityLog(prisma, req, {
        userId: session?.user?.id ?? null,
        action: 'SUBMISSION_FILE_DOWNLOAD_DENIED',
        severity: 'SECURITY',
        metadata: {},
      });
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const uploadsDir = path.join('/private', 'uploads', 'submissions');
    const filePath = path.join(uploadsDir, file);
    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: 'File not found on disk' }, { status: 404 });
    }

    const buffer = await fs.promises.readFile(filePath);

    await createEnhancedActivityLog(prisma, req, {
      userId: session.user.id,
      action: 'DOWNLOAD_SUBMISSION_FILE',
      severity: 'INFO',
      category: 'SUBMISSION',
      assignmentId: submission.assignmentId,
      submissionId: submission.id,
      metadata: {
        fileName: file,
        originalFileName: submission.originalFileName ?? null,
        studentId: submission.studentId,
      },
    });

    const headers: Record<string, string> = {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${submission.originalFileName ?? file}"`,
    };

    return new NextResponse(buffer as unknown as BodyInit, { status: 200, headers });
  } catch (err) {
    console.error('Error serving submission file:', err);
    await createEnhancedActivityLog(prisma, req, {
      userId: actorId,
      action: 'SUBMISSION_FILE_DOWNLOAD_ERROR',
      severity: 'ERROR',
      metadata: { error: err instanceof Error ? err.message : 'unknown error', fileName: fileName ?? null },
    });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
