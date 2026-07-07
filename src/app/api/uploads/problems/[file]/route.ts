import { NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import stream from 'stream';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { canAccessCourse } from '@/lib/permissions';

/**
 * Serves a problem's attached file, inline. Staff (ADMIN/FACULTY/TA) may fetch any;
 * other users must be enrolled in the problem's course. The download is audited, and
 * traversal filenames are rejected.
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
 *   403: { description: Not enrolled in the problem's course (and not staff). }
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

    const problem = await prisma.problem.findFirst({ where: { fileName: file } });
    if (!problem) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    // Any member of the problem's course (student, TA, faculty) may fetch it, as
    // may a global admin. canAccessCourse covers roster membership + admin.
    const allowed = await canAccessCourse(session.user, problem.courseId);

    if (!allowed) {
      await createEnhancedActivityLog(prisma, req, {
        userId: session?.user?.id ?? null,
        action: 'PROBLEM_FILE_DOWNLOAD_DENIED',
        severity: 'SECURITY',
        metadata: {},
      });
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const uploadsDir = path.join('/private', 'uploads', 'problems');
    const filePath = path.join(uploadsDir, file);
    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: 'File not found on disk' }, { status: 404 });
    }

    const buffer = await fs.promises.readFile(filePath);

    await createEnhancedActivityLog(prisma, req, {
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
    });
    const nodeStream = stream.Readable.from(buffer);
    const webStream = new (stream.Readable as unknown as new () => stream.Readable)().wrap(
      nodeStream,
    );

    const headers: Record<string, string> = {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `inline; filename="${problem.originalFileName ?? file}"`,
    };

    return new NextResponse(webStream as unknown as BodyInit, { status: 200, headers });
  } catch (err) {
    console.error('Error serving problem file:', err);
    await createEnhancedActivityLog(prisma, req, {
      userId: actorId,
      action: 'PROBLEM_FILE_DOWNLOAD_ERROR',
      severity: 'ERROR',
      metadata: { error: err instanceof Error ? err.message : 'unknown error', fileName: fileName ?? null },
    });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
