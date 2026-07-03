import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import stream from 'stream';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';

export async function GET(req: NextRequest, { params }: { params: Promise<{ file: string }> }) {
  try {
    const resolvedParams = await params;
    const { file } = resolvedParams;
    if (!file || file.includes('..')) {
      return NextResponse.json({ error: 'Invalid file' }, { status: 400 });
    }

    // Require authenticated user
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Find the problem record by stored filename so we can return the original name and course
    const problem = await prisma.problem.findFirst({ where: { fileName: file } });
    if (!problem) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    // Allow access only for admin/faculty/ta
    const role = session.user.role;
    if (!['ADMIN', 'FACULTY', 'TA'].includes(role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const uploadsDir = path.join('/private', 'uploads', 'solutions');
    const filePath = path.join(uploadsDir, file);
    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: 'File not found on disk' }, { status: 404 });
    }

    // Read file into buffer and return as response
    const buffer = await fs.promises.readFile(filePath);

    const shouldLogDownload = req.nextUrl.searchParams.get('download') === '1';
    if (shouldLogDownload) {
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
        },
      });
    }
    const headers: Record<string, string> = {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${problem.originalFileName ?? file}"`,
    };

    return new NextResponse(buffer as unknown as BodyInit, { status: 200, headers });
  } catch (err) {
    console.error('Error serving solution file:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
