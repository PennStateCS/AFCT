import { auth } from '@/lib/auth';
import { apiError } from '@/lib/api/http';
import { isSafeUploadName, serveUploadedFile } from '@/lib/api/serve-file';

// Map an avatar file extension to its image content-type. Uploads are validated to be
// real images (magic bytes) at write time; anything unrecognized falls back to a
// generic image type. SVG is deliberately excluded — it can carry script.
const AVATAR_CONTENT_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

function avatarContentType(file: string): string {
  const ext = file.split('.').pop()?.toLowerCase() ?? '';
  return AVATAR_CONTENT_TYPES[ext] ?? 'application/octet-stream';
}

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
    if (!isSafeUploadName(file)) {
      return apiError(400, 'Invalid file');
    }

    const session = await auth();
    if (!session?.user?.id || session.user.inactive) {
      return apiError(401, 'Unauthorized');
    }

    // Any signed-in user may fetch any avatar; no per-file authorization.
    //
    // The stored filename is a random UUID minted per upload, so a given URL's bytes
    // never change — cache it immutably (private, since it sits behind auth). Without
    // this the browser re-downloaded and re-authorized every avatar on every render and
    // page change, which made tables full of avatars feel slow to load.
    return await serveUploadedFile(file, 'pfps', {
      contentType: avatarContentType(file),
      cacheControl: 'private, max-age=31536000, immutable',
    });
  } catch (err) {
    console.error('Error serving avatar file:', err);
    return apiError(500, 'Internal server error');
  }
}
