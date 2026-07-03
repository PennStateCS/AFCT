import { NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import stream from 'stream';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';

export async function GET(req: Request, { params }: { params: Promise<{ file: string }> }) {
  try {
    const { file } = await params;
    if (!file || file.includes('..')) {
      return NextResponse.json({ error: 'Invalid file' }, { status: 400 });
    }

    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const problem = await prisma.problem.findFirst({ where: { fileName: file } });
    if (!problem) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    const role = session.user.role;
    let allowed = false;
    if (['ADMIN', 'FACULTY', 'TA'].includes(role)) allowed = true;
    else {
      const roster = await prisma.roster.findFirst({
        where: { courseId: problem.courseId, userId: session.user.id },
      });
      if (roster) allowed = true;
    }

    if (!allowed) {
      await createEnhancedActivityLog(prisma, req, {
        userId: session?.user?.id ?? null,
        action: 'PROBLEM_FILE_DOWNLOAD_DENIED',
        severity: 'SECURITY',
        metadata: { role: session?.user?.role ?? null },
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
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
