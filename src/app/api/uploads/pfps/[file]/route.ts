import { NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import stream from 'stream';
import { auth } from '@/lib/auth';

export async function GET(_: Request, { params }: { params: Promise<{ file: string }> }) {
  try {
    const { file } = await params;
    if (!file || file.includes('..')) {
      return NextResponse.json({ error: 'Invalid file' }, { status: 400 });
    }

    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const uploadsDir = path.join(process.cwd(), 'private', 'uploads', 'pfps');
    const filePath = path.join(uploadsDir, file);
    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: 'File not found on disk' }, { status: 404 });
    }

    const buffer = await fs.promises.readFile(filePath);

    const headers: Record<string, string> = {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `inline; filename="${file}"`,
    };

    return new NextResponse(buffer as unknown as BodyInit, { status: 200, headers });
  } catch (err) {
    console.error('Error serving avatar file:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
