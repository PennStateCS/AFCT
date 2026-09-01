import { auth } from '@/lib/auth';
import { apiError } from '@/lib/api/http';
import { isSafeUploadName } from '@/lib/upload-names';
import { isViewerFileKind } from '@/lib/viewer-link';
import { loadViewerProperties } from '@/lib/viewer-properties';

/**
 * Where a file in the viewer came from.
 *
 * The standalone window loads this on the server for the tabs it opens with, but a tab added
 * while the window is already open has never been near the server, so it needs a route. The
 * authorisation is not re-derived here: it is the same `loadViewerProperties` the page uses,
 * which mirrors the rule the file routes apply.
 *
 * A file that does not exist and a file that is not this reader's to see both answer 404, so
 * the panel cannot be used to find out which files exist.
 * @openapi
 * summary: Get a viewer file's properties
 * parameters:
 *   - { name: kind, in: query, required: true, schema: { type: string, enum: [submissions, problems, solutions] } }
 *   - { name: file, in: query, required: true, schema: { type: string } }
 * responses:
 *   200:
 *     description: Where the file came from, as label and value rows.
 *     content:
 *       application/json:
 *         schema:
 *           type: object
 *           properties:
 *             rows:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   label:
 *                     type: string
 *                   value:
 *                     type: string
 *   400: { description: Missing or malformed parameters. }
 *   401: { description: Not signed in. }
 *   404: { description: "No such file, or not visible to this reader." }
 */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id || session.user.inactive) {
    return apiError(401, 'Unauthorized');
  }

  const url = new URL(req.url);
  const kind = url.searchParams.get('kind');
  const file = url.searchParams.get('file');
  if (!isViewerFileKind(kind) || !isSafeUploadName(file)) {
    return apiError(400, 'Invalid file');
  }

  const properties = await loadViewerProperties(kind, file, session.user);
  if (!properties) return apiError(404, 'Not found');

  return Response.json(properties);
}
