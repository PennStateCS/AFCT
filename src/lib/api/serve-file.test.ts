import { beforeEach, describe, expect, it, vi } from 'vitest';

const fsMock = vi.hoisted(() => ({
  existsSync: vi.fn(),
  promises: { readFile: vi.fn() },
}));

vi.mock('fs', () => ({ default: fsMock }));
vi.mock('path', () => ({ default: { join: vi.fn((...args: string[]) => args.join('/')) } }));

import { isSafeUploadName, serveUploadedFile } from './serve-file';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('isSafeUploadName', () => {
  it('rejects empty, null, and undefined', () => {
    expect(isSafeUploadName('')).toBe(false);
    expect(isSafeUploadName(null)).toBe(false);
    expect(isSafeUploadName(undefined)).toBe(false);
  });

  it('rejects path-traversal sequences', () => {
    expect(isSafeUploadName('../secret.txt')).toBe(false);
    expect(isSafeUploadName('a/../../b')).toBe(false);
  });

  it('accepts a normal filename', () => {
    expect(isSafeUploadName('avatar.png')).toBe(true);
  });
});

describe('serveUploadedFile', () => {
  it('returns 404 (without reading) when the file is absent', async () => {
    fsMock.existsSync.mockReturnValue(false);
    const res = await serveUploadedFile('a.png', 'pfps');
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: 'File not found on disk' });
    expect(fsMock.promises.readFile).not.toHaveBeenCalled();
  });

  it('serves with inline/octet-stream defaults and resolves under the subdir', async () => {
    fsMock.existsSync.mockReturnValue(true);
    fsMock.promises.readFile.mockResolvedValue(Buffer.from('bytes'));
    const res = await serveUploadedFile('a.png', 'pfps');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/octet-stream');
    expect(res.headers.get('Content-Disposition')).toBe('inline; filename="a.png"');
    expect(fsMock.existsSync).toHaveBeenCalledWith('/private/uploads/pfps/a.png');
    expect(fsMock.promises.readFile).toHaveBeenCalledWith('/private/uploads/pfps/a.png');
  });

  it('honors disposition, downloadName, and contentType overrides', async () => {
    fsMock.existsSync.mockReturnValue(true);
    fsMock.promises.readFile.mockResolvedValue(Buffer.from('bytes'));
    const res = await serveUploadedFile('stored.bin', 'submissions', {
      disposition: 'attachment',
      downloadName: 'nice.pdf',
      contentType: 'application/pdf',
    });
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="nice.pdf"');
  });

  it('runs onServe after a successful read, but not on a 404', async () => {
    const onServe = vi.fn();

    fsMock.existsSync.mockReturnValue(true);
    fsMock.promises.readFile.mockResolvedValue(Buffer.from('bytes'));
    await serveUploadedFile('a.png', 'problems', { onServe });
    expect(onServe).toHaveBeenCalledTimes(1);

    onServe.mockClear();
    fsMock.existsSync.mockReturnValue(false);
    await serveUploadedFile('a.png', 'problems', { onServe });
    expect(onServe).not.toHaveBeenCalled();
  });

  it('propagates read errors so the caller can log and return 500', async () => {
    fsMock.existsSync.mockReturnValue(true);
    fsMock.promises.readFile.mockRejectedValue(new Error('disk'));
    const onServe = vi.fn();
    await expect(serveUploadedFile('a.png', 'pfps', { onServe })).rejects.toThrow('disk');
    expect(onServe).not.toHaveBeenCalled();
  });
});
