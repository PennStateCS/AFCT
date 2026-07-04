import { NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';

const CATEGORY_FOLDERS: Record<string, string> = {
  solutions: 'solutions',
  submissions: 'submissions',
  pfps: 'pfps',
  problems: 'problems',
};

const isSafeFileName = (name: string) => {
  if (!name) return false;
  if (name.includes('..')) return false;
  if (name.includes('/') || name.includes('\\')) return false;
  return true;
};

export async function DELETE(req: Request) {
  try {
    const session = await auth();
    const role = session?.user?.role;
    if (!session?.user?.id || !role || !['ADMIN', 'FACULTY', 'TA'].includes(role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = (await req.json().catch(() => null)) as {
      category?: string;
      fileName?: string;
    } | null;
    const category = body?.category?.trim();
    const fileName = body?.fileName?.trim();

    if (!category || !fileName || !CATEGORY_FOLDERS[category] || !isSafeFileName(fileName)) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }

    if (category === 'solutions' || category === 'problems') {
      const existing = await prisma.problem.findFirst({ where: { fileName } });
      if (existing) {
        return NextResponse.json({ error: 'File is still referenced' }, { status: 409 });
      }
    } else if (category === 'submissions') {
      const existing = await prisma.submission.findFirst({ where: { fileName } });
      if (existing) {
        return NextResponse.json({ error: 'File is still referenced' }, { status: 409 });
      }
    } else if (category === 'pfps') {
      const existing = await prisma.user.findFirst({ where: { avatar: fileName } });
      if (existing) {
        return NextResponse.json({ error: 'File is still referenced' }, { status: 409 });
      }
    }

    const uploadsRoot = path.join('/private', 'uploads');
    const folder = CATEGORY_FOLDERS[category];
    const baseDir = path.join(uploadsRoot, folder);
    const filePath = path.join(baseDir, fileName);
    const resolvedBase = path.resolve(baseDir);
    const resolvedFile = path.resolve(filePath);

    if (!resolvedFile.startsWith(resolvedBase)) {
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    }

    if (!fs.existsSync(resolvedFile)) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    await fs.promises.unlink(resolvedFile);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('Delete abandoned file error:', err);
    await createEnhancedActivityLog(prisma, req, {
      userId: null,
      action: 'ABANDONED_FILES_DELETE_ERROR',
      severity: 'ERROR',
      metadata: { error: err instanceof Error ? err.message : 'unknown error' },
    });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
