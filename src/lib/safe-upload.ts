import { randomUUID } from 'crypto';
import { unlink } from 'fs/promises';
import path from 'path';

/**
 * Helpers for storing uploaded files safely.
 *
 * A client-supplied filename (multipart `file.name`) is untrusted: an API client
 * can send path separators, `..`, null bytes, or odd characters. It must NEVER be
 * used to build the path we write to. Instead we store every upload under a random
 * UUID plus a sanitized extension, and keep the original name only as display
 * metadata (a plain string in the DB, escaped when rendered). Files are written
 * non-executable.
 */

/**
 * A safe file extension derived from an untrusted name: a leading dot followed by
 * 1–10 alphanumerics, lowercased. Anything else (no extension, path separators,
 * multi-dot tricks, unusual characters) yields `''`.
 */
export function safeExtension(originalName: string | null | undefined): string {
  if (!originalName) return '';
  const ext = path.extname(originalName);
  return /^\.[A-Za-z0-9]{1,10}$/.test(ext) ? ext.toLowerCase() : '';
}

/**
 * A stored filename that never derives its path from client input: an optional
 * caller-controlled `prefix` (must itself be a safe string, e.g. a cuid userId),
 * a random UUID, and a sanitized extension taken from `originalName`.
 */
export function safeStoredFilename(originalName: string | null | undefined, prefix = ''): string {
  return `${prefix}${randomUUID()}${safeExtension(originalName)}`;
}

/**
 * Resolve `filename` inside `dir` and assert the result cannot escape `dir`
 * (defense-in-depth against path traversal, including for filenames read back
 * from storage). Returns the absolute path; throws if it would escape.
 */
export function resolveInsideDir(dir: string, filename: string): string {
  const base = path.resolve(dir);
  const resolved = path.resolve(base, filename);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    throw new Error('Resolved upload path escapes the upload directory');
  }
  return resolved;
}

/**
 * Best-effort delete of a stored upload: resolves the name inside `dir` (so a
 * legacy/unsafe stored name can't escape) and swallows any error — a missing file
 * or an unsafe name must never turn cleanup into a fatal request error.
 */
export async function safeUnlinkInDir(dir: string, filename: string): Promise<void> {
  try {
    await unlink(resolveInsideDir(dir, filename));
  } catch {
    // ignore — cleanup is best-effort
  }
}
