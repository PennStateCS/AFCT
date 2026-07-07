import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { canManageCourse } from '@/lib/permissions';

/**
 * Serves a problem's solution file — the most sensitive protected material, so
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
    if (!file || file.includes('..')) {
      return NextResponse.json({ error: 'Invalid file' }, { status: 400 });
    }

    // Require authenticated user
    const session = await auth();
    actorId = session?.user?.id ?? null;
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Find the problem record by stored filename so we can return the original name and course
    const problem = await prisma.problem.findFirst({ where: { fileName: file } });
    if (!problem) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    // Allow access only for course staff (faculty/TA) or a global admin.
    if (!(await canManageCourse(session.user, problem.courseId))) {
      await createEnhancedActivityLog(prisma, req, {
        userId: session?.user?.id ?? null,
        action: 'SOLUTION_DOWNLOAD_DENIED',
        severity: 'SECURITY',
        metadata: {},
      });
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const uploadsDir = path.join('/private', 'uploads', 'solutions');
    const filePath = path.join(uploadsDir, file);
    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: 'File not found on disk' }, { status: 404 });
    }

    // Read file into buffer and return as response
    const buffer = await fs.promises.readFile(filePath);

    // Solutions are the most sensitive protected material, so log every successful
    // serve (not only the explicit ?download=1 variant).
    const mode = req.nextUrl.searchParams.get('download') === '1' ? 'download' : 'inline';
    await createEnhancedActivityLog(prisma, req, {
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
    });
    const headers: Record<string, string> = {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${problem.originalFileName ?? file}"`,
    };

    return new NextResponse(buffer as unknown as BodyInit, { status: 200, headers });
  } catch (err) {
    console.error('Error serving solution file:', err);
    await createEnhancedActivityLog(prisma, req, {
      userId: actorId,
      action: 'SOLUTION_DOWNLOAD_ERROR',
      severity: 'ERROR',
      metadata: { error: err instanceof Error ? err.message : 'unknown error', fileName: fileName ?? null },
    });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
