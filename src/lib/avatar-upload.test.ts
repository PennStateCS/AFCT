import { describe, expect, it } from 'vitest';
import { detectImageType, readAndValidateAvatar } from './avatar-upload';

const sig = {
  png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  jpeg: [0xff, 0xd8, 0xff, 0xe0],
  gif87: [0x47, 0x49, 0x46, 0x38, 0x37, 0x61],
  gif89: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61],
};

const webp = () => Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')]);

/** Minimal File stand-in exposing size/type/arrayBuffer, which is all the validator reads. */
const fakeFile = (bytes: number[] | Buffer, type = 'image/png', size?: number): File => {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  return {
    size: size ?? buf.length,
    type,
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  } as unknown as File;
};

const limit = { maxBytes: 1024 * 1024, maxMb: 1 };

describe('detectImageType', () => {
  it('recognizes PNG, JPEG, GIF (87a/89a), and WEBP by signature', () => {
    expect(detectImageType(Buffer.from(sig.png))).toBe('image/png');
    expect(detectImageType(Buffer.from(sig.jpeg))).toBe('image/jpeg');
    expect(detectImageType(Buffer.from(sig.gif87))).toBe('image/gif');
    expect(detectImageType(Buffer.from(sig.gif89))).toBe('image/gif');
    expect(detectImageType(webp())).toBe('image/webp');
  });

  it('returns null for non-image bytes', () => {
    expect(detectImageType(Buffer.from('<html>hi</html>'))).toBeNull();
    expect(detectImageType(Buffer.from([0x00, 0x01, 0x02]))).toBeNull();
    // A RIFF container that is not WEBP (e.g. WAV) is rejected.
    expect(
      detectImageType(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE')])),
    ).toBeNull();
  });
});

describe('readAndValidateAvatar', () => {
  it('accepts a real PNG and returns the buffer', async () => {
    const res = await readAndValidateAvatar(fakeFile(sig.png), limit);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.type).toBe('image/png');
  });

  it('rejects a file over the size limit with 413 before reading bytes', async () => {
    const res = await readAndValidateAvatar(fakeFile(sig.png, 'image/png', limit.maxBytes + 1), limit);
    expect(res).toMatchObject({ ok: false, status: 413 });
  });

  it('rejects a non-image declared type with 400', async () => {
    const res = await readAndValidateAvatar(fakeFile(sig.png, 'text/html'), limit);
    expect(res).toMatchObject({ ok: false, status: 400 });
  });

  it('rejects an image-typed file whose bytes are not an image (400)', async () => {
    // Declared image/png, but the content is HTML: the signature check catches it.
    const res = await readAndValidateAvatar(fakeFile(Buffer.from('<svg onload=alert(1)>'), 'image/png'), limit);
    expect(res).toMatchObject({ ok: false, status: 400 });
  });
});
