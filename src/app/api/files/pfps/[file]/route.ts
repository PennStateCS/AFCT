import { auth } from '@/lib/auth';
import { apiError } from '@/lib/api/http';
import { isSafeUploadName, serveUploadedFile } from '@/lib/api/serve-file';

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
    if (!session?.user?.id) {
      return apiError(401, 'Unauthorized');
    }

    // Any signed-in user may fetch any avatar; no per-file authorization.
    return await serveUploadedFile(file, 'pfps');
  } catch (err) {
    console.error('Error serving avatar file:', err);
    return apiError(500, 'Internal server error');
  }
}
