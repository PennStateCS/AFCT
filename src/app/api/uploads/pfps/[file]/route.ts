import { NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import { auth } from '@/lib/auth';

/**
 * Serves an avatar image from private storage, inline. Any signed-in user may fetch
 * one (avatars are shown throughout the app). The filename is rejected if it
 * contains a path-traversal sequence.
 * @openapi
 * summary: Get an avatar file
 * parameters:
 *   - { name: file, in: path, required: true, schema: { type: string } }
 * responses:
 *   200:
 *     description: The image bytes (inline).
 *     content:
 *       application/octet-stream:
 *         schema: { type: string, format: binary }
 *   400: { description: Invalid filename. }
 *   401: { description: Not signed in. }
 *   404: { description: File not found. }
 *   500: { description: Server error. }
 */
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
