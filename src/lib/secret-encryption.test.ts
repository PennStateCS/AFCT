import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  decryptSecret,
  encryptSecret,
  hasSecretKey,
  isEncrypted,
  readStoredSecret,
  SecretKeyError,
  SECRET_KEY_ENV,
  PREVIOUS_SECRET_KEY_ENV,
} from './secret-encryption';

const KEY = 'a'.repeat(48);
const OTHER_KEY = 'b'.repeat(48);

const setKeys = (active?: string, previous?: string) => {
  if (active === undefined) delete process.env[SECRET_KEY_ENV];
  else process.env[SECRET_KEY_ENV] = active;
  if (previous === undefined) delete process.env[PREVIOUS_SECRET_KEY_ENV];
  else process.env[PREVIOUS_SECRET_KEY_ENV] = previous;
};

const original = {
  active: process.env[SECRET_KEY_ENV],
  previous: process.env[PREVIOUS_SECRET_KEY_ENV],
};

beforeEach(() => setKeys(KEY));
afterEach(() => setKeys(original.active, original.previous));

describe('encryptSecret / decryptSecret', () => {
  it('round-trips a secret', () => {
    expect(decryptSecret(encryptSecret('hunter2'))).toBe('hunter2');
  });

  it('round-trips values that are not simple ASCII', () => {
    const value = 'pa55 word · ünïcode · 🔐';
    expect(decryptSecret(encryptSecret(value))).toBe(value);
  });

  // Everywhere else an empty string means "not configured", so encrypted emptiness would be a
  // value that reads as configured and behaves as absent. Callers clear a secret with null.
  it('refuses to encrypt an empty value', () => {
    expect(() => encryptSecret('')).toThrow(/store null/);
  });

  // A fresh IV per call, so the same password stored twice does not produce the same column
  // value and give away that two installs share a secret.
  it('produces different ciphertext for the same input', () => {
    expect(encryptSecret('same')).not.toBe(encryptSecret('same'));
  });

  it('marks its own output so a stored value can be recognised', () => {
    expect(isEncrypted(encryptSecret('x'))).toBe(true);
    expect(isEncrypted('plaintext-from-before-this-existed')).toBe(false);
    expect(isEncrypted(null)).toBe(false);
  });
});

/**
 * The property the whole design rests on: a database without its host key is useless. If any of
 * these ever returned a value instead of throwing, the separation would be decorative.
 */
describe('failing closed', () => {
  it('refuses to encrypt with no key configured', () => {
    setKeys(undefined);
    expect(() => encryptSecret('x')).toThrow(SecretKeyError);
  });

  it('refuses to decrypt with no key configured, and says the data is intact', () => {
    const stored = encryptSecret('x');
    setKeys(undefined);

    expect(() => decryptSecret(stored)).toThrow(/not set/);
    expect(() => decryptSecret(stored)).toThrow(/unharmed/);
  });

  it('refuses to decrypt with the wrong key rather than returning anything', () => {
    const stored = encryptSecret('x');
    setKeys(OTHER_KEY);

    expect(() => decryptSecret(stored)).toThrow(SecretKeyError);
  });

  // The message is the feature here: this is what someone sees after restoring a backup onto a
  // new machine, and it must not read as data loss.
  it('explains a restore onto a different host', () => {
    const stored = encryptSecret('x');
    setKeys(OTHER_KEY);

    expect(() => decryptSecret(stored)).toThrow(/restored onto a different host/);
    expect(() => decryptSecret(stored)).toThrow(/data is intact/);
  });

  it('rejects a key that is too short to be a real one', () => {
    setKeys('short');
    expect(() => encryptSecret('x')).toThrow(/at least/);
  });

  it('refuses to decrypt something it did not write', () => {
    expect(() => decryptSecret('just-a-plaintext-password')).toThrow(/not encrypted/);
  });

  it('refuses a truncated or malformed value', () => {
    expect(() => decryptSecret('enc.v1:only-one-part')).toThrow(/malformed/);
  });

  // Tampering must be detected, which is why this is AES-GCM and not a bare cipher.
  it('refuses a value whose ciphertext has been altered', () => {
    const stored = encryptSecret('hunter2');
    const parts = stored.split(':');
    parts[3] = Buffer.from('tampered-with').toString('base64url');

    expect(() => decryptSecret(parts.join(':'))).toThrow(SecretKeyError);
  });
});

/**
 * Rotation: the new key is active and the old one lingers as PREVIOUS while values are being
 * rewritten. Without this a rotation would black out every stored secret between the restart
 * and the last rewrite.
 */
describe('rotation', () => {
  it('reads a value written under the previous key', () => {
    const stored = encryptSecret('written-before-rotation');
    setKeys(OTHER_KEY, KEY);

    expect(decryptSecret(stored)).toBe('written-before-rotation');
  });

  it('writes new values under the active key only', () => {
    setKeys(OTHER_KEY, KEY);
    const stored = encryptSecret('written-after-rotation');
    setKeys(OTHER_KEY);

    expect(decryptSecret(stored)).toBe('written-after-rotation');
  });

  it('still fails when neither key fits', () => {
    const stored = encryptSecret('x');
    setKeys(OTHER_KEY, 'c'.repeat(48));

    expect(() => decryptSecret(stored)).toThrow(new RegExp(PREVIOUS_SECRET_KEY_ENV));
  });
});

describe('readStoredSecret', () => {
  it('decrypts an encrypted value', () => {
    expect(readStoredSecret(encryptSecret('secret'))).toBe('secret');
  });

  // Existing installs have plaintext in these columns and are rewritten on the next save.
  it('passes through a plaintext value from before encryption existed', () => {
    expect(readStoredSecret('legacy-plaintext')).toBe('legacy-plaintext');
  });

  it('treats absent and empty as no secret', () => {
    expect(readStoredSecret(null)).toBeNull();
    expect(readStoredSecret(undefined)).toBeNull();
    expect(readStoredSecret('')).toBeNull();
  });
});

describe('hasSecretKey', () => {
  it('reports whether a key is configured', () => {
    expect(hasSecretKey()).toBe(true);
    setKeys(undefined);
    expect(hasSecretKey()).toBe(false);
  });

  it('treats a blank key as absent', () => {
    setKeys('   ');
    expect(hasSecretKey()).toBe(false);
  });
});

/**
 * The authentication tag is what makes a stored secret tamper-evident, so its length is not a
 * detail the caller gets to choose. Node accepts several shorter GCM tags unless told
 * otherwise, and a shorter tag is cheaper to forge, so both sides pin 16 bytes.
 */
describe('authentication tag length', () => {
  const parts = (stored: string) => stored.split(':');

  it('writes a full 16-byte tag', () => {
    const [, , tag] = parts(encryptSecret('hunter2'));

    expect(Buffer.from(tag, 'base64url')).toHaveLength(16);
  });

  it('refuses a stored value whose tag has been truncated', () => {
    const [prefix, iv, tag, ciphertext] = parts(encryptSecret('hunter2'));
    const short = Buffer.from(tag, 'base64url').subarray(0, 8).toString('base64url');

    const tampered = [prefix, iv, short, ciphertext].join(':');

    // Without the pinned length Node would accept the 8-byte tag and authenticate against
    // half the bits, and because it is a genuine prefix of the real tag it would decrypt
    // cleanly. Pinned, it fails closed like any other unreadable secret.
    expect(() => decryptSecret(tampered)).toThrow(SecretKeyError);
  });

  it('still refuses a full-length tag that is wrong', () => {
    const [prefix, iv, tag, ciphertext] = parts(encryptSecret('hunter2'));
    const flipped = Buffer.from(tag, 'base64url');
    flipped[0] ^= 0xff;

    const tampered = [prefix, iv, flipped.toString('base64url'), ciphertext].join(':');

    expect(() => decryptSecret(tampered)).toThrow(SecretKeyError);
  });
});
