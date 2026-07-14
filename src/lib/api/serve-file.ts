import { NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import { resolveInsideDir } from '@/lib/safe-upload';
import { apiError } from './http';

/** The subdirectories under the private uploads root that we serve files from. */
export type UploadSubdir = 'pfps' | 'problems' | 'submissions' | 'solutions';

/**
 * Guards a user-supplied filename. It must be a bare basename (no directory parts)
 * with no path separators, null bytes, control characters, or `..` traversal
 * sequences. Narrows to `string` so callers can use it in a type guard.
 */
export function isSafeUploadName(file: string | null | undefined): file is string {
  return (
    typeof file === 'string' &&
    file.length > 0 &&
    // Reject path separators, null bytes, and control characters (leaves a bare
    // basename), plus any `..` traversal sequence.
    !/[\\/\x00-\x1f]/.test(file) &&
    !file.includes('..')
  );
}

/** Sanitize a name for the quoted `filename` param (strip quotes/backslashes/CR/LF). */
function sanitizeDispositionName(name: string): string {
  return name.replace(/["\\\r\n]/g, '_');
}

export type ServeFileOptions = {
  /** `inline` (default) to display in-browser, `attachment` to force a download. */
  disposition?: 'inline' | 'attachment';
  /** Name offered to the browser; defaults to the stored filename. */
  downloadName?: string;
  /** Response Content-Type; defaults to `application/octet-stream`. */
  contentType?: string;
  /**
   * Runs after a successful read but before the response is built: the place to
   * record a download in the audit log, so it only fires when the file truly served.
   */
  onServe?: () => Promise<void> | void;
};

/**
 * Reads a file from the private uploads tree (`/private/uploads/<subdir>/<file>`)
 * and returns it as a response. Returns 404 when the file is absent on disk; lets
 * read errors throw so the caller's try/catch can log and return 500.
 *
 * Authentication and authorization stay in the calling route; those rules differ
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
  // Defense-in-depth: resolve inside the subdir and assert the result can't escape,
  // even if a legacy/unsafe stored name slipped past isSafeUploadName.
  const filePath = resolveInsideDir(path.join('/private', 'uploads', subdir), file);
  if (!fs.existsSync(filePath)) {
    return apiError(404, 'File not found on disk');
  }

  const buffer = await fs.promises.readFile(filePath);
  await opts.onServe?.();

  const disposition = opts.disposition ?? 'inline';
  const name = opts.downloadName ?? file;
  // Offer both a sanitized ASCII `filename` (older clients) and an RFC 5987
  // `filename*` so an attacker-supplied original name can't break out of the
  // header or corrupt non-ASCII names.
  const contentDisposition = `${disposition}; filename="${sanitizeDispositionName(name)}"; filename*=UTF-8''${encodeURIComponent(name)}`;
  return new NextResponse(buffer as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': opts.contentType ?? 'application/octet-stream',
      'Content-Disposition': contentDisposition,
    },
  });
}
