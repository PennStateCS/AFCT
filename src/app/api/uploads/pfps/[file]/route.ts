import { NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
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

    const uploadsDir = path.join('/private', 'uploads', 'pfps');
    const filePath = path.join(uploadsDir, file);
    if (!fs.existsSync(filePath)) {
      if (file === 'default-avatar.png') {
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256" role="img" aria-label="Default avatar"><rect width="256" height="256" fill="#e5e7eb"/><circle cx="128" cy="100" r="44" fill="#9ca3af"/><path d="M48 230c0-44.2 35.8-80 80-80s80 35.8 80 80" fill="#9ca3af"/></svg>`;
        return new NextResponse(svg, {
          status: 200,
          headers: {
            'Content-Type': 'image/svg+xml; charset=utf-8',
            'Cache-Control': 'public, max-age=3600',
            'Content-Disposition': 'inline; filename="default-avatar.svg"',
          },
        });
      }
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
