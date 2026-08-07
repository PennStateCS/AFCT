import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fsMock = vi.hoisted(() => ({
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  renameSync: vi.fn(),
  readFileSync: vi.fn(),
  statSync: vi.fn(),
}));
vi.mock('fs', () => ({ default: fsMock, ...fsMock }));

import {
  isValidTag,
  isValidRestorePoint,
  currentVersion,
  fetchManifest,
  readStatus,
  readRestorePoints,
  updaterAvailable,
  updaterReadiness,
  withBackupDetails,
  writeUpdateRequest,
  writeDowngradeRequest,
  writeSelfUpdateRequest,
  UPDATE_REQUEST_FILE,
  UPDATE_PROGRESS_FILE,
} from '@/lib/updates';

// The request writers also clear the live progress log so the UI streams only the new
// run's output; that reset is a writeFileSync to the progress file. Pick out the actual
// request payload write (the temp file that gets renamed) rather than assuming an index.
function requestPayload() {
  const call = fsMock.writeFileSync.mock.calls.find((c) => c[0] !== UPDATE_PROGRESS_FILE);
  if (!call) throw new Error('no request payload was written');
  return JSON.parse(call[1] as string);
}

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

describe('withBackupDetails', () => {
  const points = [
    { version: 'v0.1.1', backup: '20260101-000000' },
    { version: 'v0.1.2', backup: '20260202-000000' },
  ];

  it('fills in size and encrypted from the matching backup file', () => {
    const result = withBackupDetails(points, [
      { timestamp: '20260101-000000', size: 1024, encrypted: false },
      { timestamp: '20260202-000000', size: 2048, encrypted: true },
    ]);
    expect(result[0]).toMatchObject({ size: 1024, encrypted: false });
    expect(result[1]).toMatchObject({ size: 2048, encrypted: true });
  });

  it('leaves details undefined when no backup file matches', () => {
    const result = withBackupDetails(points, [
      { timestamp: '20260101-000000', size: 1024, encrypted: false },
    ]);
    expect(result[1].size).toBeUndefined();
    expect(result[1].encrypted).toBeUndefined();
  });
});

describe('updaterReadiness', () => {
  it('reads the updater self-report', () => {
    fsMock.readFileSync.mockReturnValue(
      JSON.stringify({
        envFile: '/afct-shared/.env.production',
        composeFile: '/afct-compose/docker-compose.yml',
        envFileOk: false,
        composeFileOk: true,
      }),
    );
    expect(updaterReadiness()).toEqual({
      envFile: '/afct-shared/.env.production',
      composeFile: '/afct-compose/docker-compose.yml',
      envFileOk: false,
      composeFileOk: true,
    });
  });

  // Null means "no report", which the UI must not treat as a fault: an updater older than
  // this stamp never writes the file, and that is the normal state right after upgrading.
  it('returns null when the file is absent', () => {
    fsMock.readFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    expect(updaterReadiness()).toBeNull();
  });

  it('returns null for malformed content rather than guessing', () => {
    fsMock.readFileSync.mockReturnValue('not json');
    expect(updaterReadiness()).toBeNull();
    fsMock.readFileSync.mockReturnValue(JSON.stringify({ envFileOk: 'yes' }));
    expect(updaterReadiness()).toBeNull();
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

describe('updaterAvailable', () => {
  it('true when the sidecar heartbeat is fresh', () => {
    fsMock.statSync.mockReturnValue({ mtimeMs: Date.now() - 2_000 });
    expect(updaterAvailable()).toBe(true);
  });
  it('false when the heartbeat is stale', () => {
    fsMock.statSync.mockReturnValue({ mtimeMs: Date.now() - 10 * 60_000 });
    expect(updaterAvailable()).toBe(false);
  });
  it('false when the heartbeat file is missing', () => {
    fsMock.statSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    expect(updaterAvailable()).toBe(false);
  });
});

describe('writeUpdateRequest', () => {
  it('writes an upgrade payload atomically (temp then rename)', () => {
    writeUpdateRequest({ tag: 'v1.1.0', requestedBy: 'admin1', requestId: 'r1' });
    expect(fsMock.mkdirSync).toHaveBeenCalled();
    expect(requestPayload()).toMatchObject({
      action: 'upgrade',
      tag: 'v1.1.0',
      requestedBy: 'admin1',
      requestId: 'r1',
      backupFirst: true,
    });
    // The temp file is renamed into the real request path the sidecar watches.
    expect(fsMock.renameSync).toHaveBeenCalledWith(expect.any(String), UPDATE_REQUEST_FILE);
  });
  it('honors backupFirst:false', () => {
    writeUpdateRequest({ tag: 'v1.1.0', requestedBy: 'a', requestId: 'r', backupFirst: false });
    expect(requestPayload().backupFirst).toBe(false);
  });
  it('clears the live progress log so the stream starts on this run, not the last one', () => {
    writeUpdateRequest({ tag: 'v1.1.0', requestedBy: 'admin1', requestId: 'r1' });
    expect(fsMock.writeFileSync).toHaveBeenCalledWith(UPDATE_PROGRESS_FILE, '');
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
    expect(requestPayload()).toMatchObject({
      action: 'downgrade',
      tag: 'v0.9.0',
      restorePoint: '20260101-000000',
      requestedBy: 'admin1',
      requestId: 'd1',
    });
    expect(fsMock.renameSync).toHaveBeenCalledWith(expect.any(String), UPDATE_REQUEST_FILE);
  });
  it('clears the live progress log', () => {
    writeDowngradeRequest({
      tag: 'v0.9.0',
      restorePoint: '20260101-000000',
      requestedBy: 'admin1',
      requestId: 'd1',
    });
    expect(fsMock.writeFileSync).toHaveBeenCalledWith(UPDATE_PROGRESS_FILE, '');
  });
  it('omits force by default', () => {
    writeDowngradeRequest({
      tag: 'v0.9.0',
      restorePoint: '20260101-000000',
      requestedBy: 'admin1',
      requestId: 'd1',
    });
    expect(requestPayload()).not.toHaveProperty('force');
  });
  it('includes force only when set true', () => {
    writeDowngradeRequest({
      tag: 'v0.9.0',
      restorePoint: '20260101-000000',
      requestedBy: 'admin1',
      requestId: 'd1',
      force: true,
    });
    expect(requestPayload()).toMatchObject({ action: 'downgrade', force: true });
  });
});

describe('writeSelfUpdateRequest', () => {
  it('writes a self-update payload and clears the live progress log', () => {
    writeSelfUpdateRequest({ tag: 'v1.1.0', requestedBy: 'admin1', requestId: 's1' });
    expect(requestPayload()).toMatchObject({
      action: 'self-update',
      tag: 'v1.1.0',
      requestedBy: 'admin1',
      requestId: 's1',
    });
    expect(fsMock.writeFileSync).toHaveBeenCalledWith(UPDATE_PROGRESS_FILE, '');
    expect(fsMock.renameSync).toHaveBeenCalledWith(expect.any(String), UPDATE_REQUEST_FILE);
  });
});
