/**
 * Encryption at rest for the secrets AFCT stores in its own database.
 *
 * The key lives on the host (an environment variable written by the installer); the encrypted
 * values live in the database. That separation is the whole point: a stolen database, or a
 * leaked backup, is useless without the host. Never move the key into the database, and never
 * let a value fall back to plaintext when the key is missing.
 *
 * Used for the SMTP password, the SSO client secret and the LTI signing key. Those last two
 * are what make this worth doing: an LTI private key signs assertions about who a person is,
 * and it would otherwise sit in every nightly backup in the clear.
 *
 * Kept dependency-free (node crypto and `process.env` only) so it can be imported from
 * anywhere on the server without dragging Prisma or config loading along with it.
 */

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'crypto';

/** Environment variable holding the active key. Written by both installers. */
export const SECRET_KEY_ENV = 'AFCT_SECRET_KEY';

/**
 * The key being rotated away from. Set only while a rotation is in flight: decryption tries
 * the active key first and falls back to this, so values written before the rotation still
 * open while they are being rewritten.
 */
export const PREVIOUS_SECRET_KEY_ENV = 'AFCT_SECRET_KEY_PREVIOUS';

/**
 * Minimum acceptable key length, matching `MIN_AUTH_SECRET_LENGTH`. The installers generate 48
 * hex characters via `gen_secret`, so a real deployment is comfortably over this; the check is
 * here to reject a hand-edited placeholder rather than to grade real keys.
 */
export const MIN_SECRET_KEY_LENGTH = 32;

/** Marks our own ciphertext so a stored value can be told from a legacy plaintext one. */
const PREFIX = 'enc.v1';

/**
 * Field separator. Deliberately not a dot: the prefix contains one, and base64url's alphabet
 * (A-Za-z0-9-_) never does, so a colon splits the parts unambiguously.
 */
const SEP = ':';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // 96 bits, the size GCM is defined for
const KEY_BYTES = 32; // AES-256
/**
 * Full-length GCM authentication tag, stated rather than left to the default.
 *
 * Node will otherwise accept a short tag on decryption (4 bytes among others), and a short tag
 * is correspondingly cheaper to forge. Encryption has always written 16, so pinning it here
 * only closes the reading side: a stored value whose tag has been truncated is now rejected
 * outright instead of being authenticated against fewer bits than it should be.
 */
const TAG_BYTES = 16;

/**
 * Thrown when a secret cannot be read. Deliberately its own type so callers can tell "the key
 * is wrong or missing" apart from "this row has no secret", and so a caller never mistakes a
 * key problem for corrupted data.
 */
export class SecretKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecretKeyError';
  }
}

/**
 * Turn the configured key material into 32 bytes for AES-256.
 *
 * The installers produce 48 hex characters, which is 24 bytes, and an admin who sets the value
 * by hand could supply anything at all. HKDF is the standard way to derive a fixed-length key
 * from arbitrary high-entropy material, so the accepted input is not constrained by the cipher.
 */
function deriveKey(material: string): Buffer {
  return Buffer.from(hkdfSync('sha256', Buffer.from(material, 'utf8'), Buffer.alloc(0), PREFIX, KEY_BYTES));
}

function readKey(envName: string): string | null {
  const raw = process.env[envName];
  if (!raw) return null;
  const value = raw.trim();
  return value.length > 0 ? value : null;
}

/**
 * The active key, or null when none is configured. Callers that need one must say so; this
 * returns null rather than throwing so a surface can report "encryption is not configured"
 * without a try/catch.
 */
export function hasSecretKey(): boolean {
  return readKey(SECRET_KEY_ENV) !== null;
}

function requireKey(): Buffer {
  const material = readKey(SECRET_KEY_ENV);
  if (!material) {
    throw new SecretKeyError(
      `${SECRET_KEY_ENV} is not set, so stored secrets cannot be read or written. ` +
        'It is generated during installation and written to the deployment environment file. ' +
        'Restore it there and restart; the encrypted values themselves are unharmed.',
    );
  }
  if (material.length < MIN_SECRET_KEY_LENGTH) {
    throw new SecretKeyError(
      `${SECRET_KEY_ENV} is too short (need at least ${MIN_SECRET_KEY_LENGTH} characters).`,
    );
  }
  return deriveKey(material);
}

/** Whether a stored value is one of ours, as opposed to a plaintext value predating this. */
export function isEncrypted(stored: string | null | undefined): boolean {
  return typeof stored === 'string' && stored.startsWith(`${PREFIX}${SEP}`);
}

/**
 * Encrypt a secret for storage. The result is self-describing: version, IV, auth tag and
 * ciphertext, so a future change of algorithm can be told apart from this one rather than
 * having to guess at what a column contains.
 */
export function encryptSecret(plaintext: string): string {
  // An empty secret is not a secret. Everywhere else in AFCT an empty string means "not
  // configured", so a caller clearing a value must store null rather than encrypted emptiness,
  // which would read as configured and behave as absent.
  if (plaintext === '') {
    throw new SecretKeyError('Refusing to encrypt an empty value; store null to clear a secret.');
  }
  const key = requireKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    PREFIX,
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join(SEP);
}

function decryptWith(material: string, iv: Buffer, tag: Buffer, ciphertext: Buffer): string | null {
  try {
    const decipher = createDecipheriv(ALGORITHM, deriveKey(material), iv, {
      authTagLength: TAG_BYTES,
    });
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    // GCM authentication failed, which means the wrong key. Reported by the caller, not here,
    // so that "wrong key" and "no key at all" produce different messages.
    return null;
  }
}

/**
 * Decrypt a stored secret.
 *
 * Tries the active key, then the previous one if a rotation is in flight, so values written
 * before a rotation keep opening while they are rewritten.
 *
 * Fails closed. A wrong or missing key throws rather than returning null, because the one
 * outcome that must never happen is a caller treating an unreadable secret as an absent one and
 * carrying on with no SMTP password, no client secret, or an unsigned LTI request.
 */
export function decryptSecret(stored: string): string {
  if (!isEncrypted(stored)) {
    throw new SecretKeyError('Stored value is not encrypted; refusing to guess at its contents.');
  }
  const [, ivPart, tagPart, dataPart] = stored.split(SEP);
  if (!ivPart || !tagPart || !dataPart) {
    throw new SecretKeyError('Stored secret is malformed.');
  }

  const iv = Buffer.from(ivPart, 'base64url');
  const tag = Buffer.from(tagPart, 'base64url');
  const ciphertext = Buffer.from(dataPart, 'base64url');

  const active = readKey(SECRET_KEY_ENV);
  if (!active) {
    throw new SecretKeyError(
      `${SECRET_KEY_ENV} is not set, so stored secrets cannot be read. ` +
        'It is generated during installation and written to the deployment environment file. ' +
        'Restore it there and restart; the encrypted values themselves are unharmed.',
    );
  }

  const withActive = decryptWith(active, iv, tag, ciphertext);
  if (withActive !== null) return withActive;

  const previous = readKey(PREVIOUS_SECRET_KEY_ENV);
  if (previous) {
    const withPrevious = decryptWith(previous, iv, tag, ciphertext);
    if (withPrevious !== null) return withPrevious;
  }

  throw new SecretKeyError(
    `A stored secret could not be decrypted with ${SECRET_KEY_ENV}` +
      (previous ? ` or ${PREVIOUS_SECRET_KEY_ENV}` : '') +
      '. This usually means the deployment was restored onto a different host without its key. ' +
      'The data is intact: restore the original key, or clear and re-enter the affected secrets.',
  );
}

/**
 * Read a stored value that may predate encryption.
 *
 * Existing installs have plaintext in these columns, and they are rewritten as encrypted the
 * next time an admin saves them. Until then a plaintext value is returned as-is. There is no
 * ambiguity to worry about: our ciphertext always carries the `enc.v1.` prefix.
 */
export function readStoredSecret(stored: string | null | undefined): string | null {
  if (stored === null || stored === undefined || stored === '') return null;
  return isEncrypted(stored) ? decryptSecret(stored) : stored;
}
