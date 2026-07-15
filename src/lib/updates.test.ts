import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fsMock = vi.hoisted(() => ({
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  renameSync: vi.fn(),
  readFileSync: vi.fn(),
}));
vi.mock('fs', () => ({ default: fsMock, ...fsMock }));

import {
  isValidTag,
  isValidRestorePoint,
  currentVersion,
  fetchManifest,
  readStatus,
  readRestorePoints,
  writeUpdateRequest,
  writeDowngradeRequest,
  UPDATE_REQUEST_FILE,
} from '@/lib/updates';

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('isValidTag', () => {
  it('accepts well-formed docker tags', () => {
    expect(isValidTag('v1.2.3')).toBe(true);
    expect(isValidTag('main')).toBe(true);
    expect(isValidTag('sha-abc1234')).toBe(true);
  });
  it('rejects unsafe or malformed tags', () => {
    expect(isValidTag('bad tag')).toBe(false);
    expect(isValidTag('-leading')).toBe(false);
    expect(isValidTag('has/slash')).toBe(false);
    expect(isValidTag('')).toBe(false);
  });
});

describe('currentVersion', () => {
  it('prefers IMAGE_TAG, then AFCT_APP_TAG, then main', () => {
    vi.stubEnv('IMAGE_TAG', 'v1.4.0');
    expect(currentVersion()).toBe('v1.4.0');
    vi.stubEnv('IMAGE_TAG', '');
    vi.stubEnv('AFCT_APP_TAG', 'v1.3.0');
    expect(currentVersion()).toBe('v1.3.0');
    vi.stubEnv('AFCT_APP_TAG', '');
    expect(currentVersion()).toBe('main');
  });
});

describe('fetchManifest', () => {
  it('returns valid-tag versions and drops malformed entries', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          versions: [{ tag: 'v1.1.0', label: 'x' }, { tag: 'bad tag' }, { notag: true }],
        }),
      }),
    );
    const m = await fetchManifest();
    expect(m.versions.map((v) => v.tag)).toEqual(['v1.1.0']);
  });
  it('throws when the manifest fetch is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    await expect(fetchManifest()).rejects.toThrow();
  });
});

describe('readStatus', () => {
  it('parses the status file', () => {
    fsMock.readFileSync.mockReturnValue('{"phase":"healthy","toTag":"v1.1.0"}');
    expect(readStatus()).toEqual({ phase: 'healthy', toTag: 'v1.1.0' });
  });
  it('returns null when the file is missing or unreadable', () => {
    fsMock.readFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    expect(readStatus()).toBeNull();
  });
});

describe('writeUpdateRequest', () => {
  it('writes an upgrade payload atomically (temp then rename)', () => {
    writeUpdateRequest({ tag: 'v1.1.0', requestedBy: 'admin1', requestId: 'r1' });
    expect(fsMock.mkdirSync).toHaveBeenCalled();
    const written = JSON.parse(fsMock.writeFileSync.mock.calls[0][1] as string);
    expect(written).toMatchObject({
      action: 'upgrade',
      tag: 'v1.1.0',
      requestedBy: 'admin1',
      requestId: 'r1',
      backupFirst: true,
    });
    // The temp file is renamed into the real request path the sidecar watches.
    expect(fsMock.writeFileSync.mock.calls[0][0]).not.toBe(UPDATE_REQUEST_FILE);
    expect(fsMock.renameSync).toHaveBeenCalledWith(expect.any(String), UPDATE_REQUEST_FILE);
  });
  it('honors backupFirst:false', () => {
    writeUpdateRequest({ tag: 'v1.1.0', requestedBy: 'a', requestId: 'r', backupFirst: false });
    const written = JSON.parse(fsMock.writeFileSync.mock.calls[0][1] as string);
    expect(written.backupFirst).toBe(false);
  });
});

describe('isValidRestorePoint', () => {
  it('accepts a backup timestamp and rejects anything else', () => {
    expect(isValidRestorePoint('20260101-000000')).toBe(true);
    expect(isValidRestorePoint('2026-01-01')).toBe(false);
    expect(isValidRestorePoint('../etc/passwd')).toBe(false);
    expect(isValidRestorePoint('')).toBe(false);
  });
});

describe('readRestorePoints', () => {
  it('returns well-formed points, newest first, dropping malformed ones', () => {
    fsMock.readFileSync.mockReturnValue(
      JSON.stringify([
        { version: 'v0.9.0', backup: '20260101-000000' },
        { version: 'v1.0.0', backup: '20260202-000000' },
        { version: 'bad tag', backup: '20260303-000000' }, // bad version
        { version: 'v1.1.0', backup: 'nope' }, // bad backup
      ]),
    );
    const rp = readRestorePoints();
    expect(rp.map((r) => r.backup)).toEqual(['20260202-000000', '20260101-000000']);
  });
  it('returns [] when the file is missing', () => {
    fsMock.readFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    expect(readRestorePoints()).toEqual([]);
  });
});

describe('writeDowngradeRequest', () => {
  it('writes a downgrade payload with the restore point', () => {
    writeDowngradeRequest({
      tag: 'v0.9.0',
      restorePoint: '20260101-000000',
      requestedBy: 'admin1',
      requestId: 'd1',
    });
    const written = JSON.parse(fsMock.writeFileSync.mock.calls[0][1] as string);
    expect(written).toMatchObject({
      action: 'downgrade',
      tag: 'v0.9.0',
      restorePoint: '20260101-000000',
      requestedBy: 'admin1',
      requestId: 'd1',
    });
    expect(fsMock.renameSync).toHaveBeenCalledWith(expect.any(String), UPDATE_REQUEST_FILE);
  });
});
