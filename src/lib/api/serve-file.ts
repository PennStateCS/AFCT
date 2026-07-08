import { NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import { apiError } from './http';

/** The subdirectories under the private uploads root that we serve files from. */
export type UploadSubdir = 'pfps' | 'problems' | 'submissions' | 'solutions';

/**
 * Guards a user-supplied filename: it must be non-empty and free of path-traversal
 * sequences. Narrows to `string` so callers can use it in a type guard.
 */
export function isSafeUploadName(file: string | null | undefined): file is string {
  return typeof file === 'string' && file.length > 0 && !file.includes('..');
}

export type ServeFileOptions = {
  /** `inline` (default) to display in-browser, `attachment` to force a download. */
  disposition?: 'inline' | 'attachment';
  /** Name offered to the browser; defaults to the stored filename. */
  downloadName?: string;
  /** Response Content-Type; defaults to `application/octet-stream`. */
  contentType?: string;
  /**
   * Runs after a successful read but before the response is built — the place to
   * record a download in the audit log, so it only fires when the file truly served.
   */
  onServe?: () => Promise<void> | void;
};

/**
 * Reads a file from the private uploads tree (`/private/uploads/<subdir>/<file>`)
 * and returns it as a response. Returns 404 when the file is absent on disk; lets
 * read errors throw so the caller's try/catch can log and return 500.
 *
 * Authentication and authorization stay in the calling route — those rules differ
 * per file kind (avatars vs. problems vs. submissions vs. solutions) and are the
 * whole point. This helper only owns the shared path-resolve / read / response
 * mechanics that every file route had copy-pasted. The filename must already have
 * been validated with {@link isSafeUploadName}.
 */
export async function serveUploadedFile(
  file: string,
  subdir: UploadSubdir,
  opts: ServeFileOptions = {},
): Promise<NextResponse> {
  const filePath = path.join('/private', 'uploads', subdir, file);
  if (!fs.existsSync(filePath)) {
    return apiError(404, 'File not found on disk');
  }

  const buffer = await fs.promises.readFile(filePath);
  await opts.onServe?.();

  const disposition = opts.disposition ?? 'inline';
  const name = opts.downloadName ?? file;
  return new NextResponse(buffer as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': opts.contentType ?? 'application/octet-stream',
      'Content-Disposition': `${disposition}; filename="${name}"`,
    },
  });
}
