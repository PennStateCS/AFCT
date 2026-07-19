/**
 * Centralized validation for avatar uploads, shared by `/api/me` and
 * `/api/users/[id]`.
 *
 * Both size AND content are checked: the browser-declared MIME type is a hint
 * only, so the authoritative check is the file's magic-byte signature. A file
 * whose bytes don't start with a known image header is rejected regardless of
 * its declared type or extension. Callers get back the already-read Buffer so the
 * body is only read once.
 */

/** Image types we accept for avatars. */
export type AvatarImageType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';

const ALLOWED_LABEL = 'PNG, JPEG, GIF, or WEBP';

/**
 * Identify an image purely from its leading bytes (magic number), independent of
 * the client-declared MIME type or filename. Returns null for anything that isn't
 * one of the accepted image formats.
 */
export function detectImageType(buffer: Buffer): AvatarImageType | null {
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'image/png';
  }
  // JPEG: FF D8 FF
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  // GIF: "GIF87a" or "GIF89a"
  if (
    buffer.length >= 6 &&
    buffer[0] === 0x47 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x38 &&
    (buffer[4] === 0x37 || buffer[4] === 0x39) &&
    buffer[5] === 0x61
  ) {
    return 'image/gif';
  }
  // WEBP: "RIFF"...."WEBP"
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

export type AvatarValidationResult =
  | { ok: true; buffer: Buffer; type: AvatarImageType }
  | { ok: false; status: number; error: string };

/**
 * Read and validate an uploaded avatar file: enforce the system upload-size limit,
 * a declared-MIME sanity check, and (authoritatively) the magic-byte signature.
 * Returns the decoded Buffer on success so the caller doesn't read the body twice.
 */
export async function readAndValidateAvatar(
  file: File,
  limit: { maxBytes: number; maxMb: number },
): Promise<AvatarValidationResult> {
  if (file.size > limit.maxBytes) {
    return { ok: false, status: 413, error: `File exceeds max upload size (${limit.maxMb} MB).` };
  }
  // Cheap early reject on the declared type when present; the signature check
  // below is the real gate.
  const declared = (file.type || '').toLowerCase();
  if (declared && !declared.startsWith('image/')) {
    return { ok: false, status: 400, error: `Avatar must be an image (${ALLOWED_LABEL}).` };
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const type = detectImageType(buffer);
  if (!type) {
    return { ok: false, status: 400, error: `Avatar must be a valid image (${ALLOWED_LABEL}).` };
  }
  return { ok: true, buffer, type };
}
