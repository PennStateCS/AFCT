import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Readable } from 'stream';

const authMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());
const isValidBackupNameMock = vi.hoisted(() => vi.fn());
const statSyncMock = vi.hoisted(() => vi.fn());
const createReadStreamMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));
vi.mock('@/lib/backups', () => ({
  BACKUP_DIR: '/backups',
  isValidBackupName: isValidBackupNameMock,
}));
vi.mock('fs', () => {
  const api = { statSync: statSyncMock, createReadStream: createReadStreamMock };
  return { default: api, ...api };
});

import { GET } from './route';

const admin = { user: { id: 'a1', role: 'ADMIN', isAdmin: true } };
const VALID = 'afct-20260101-000000.dump';
const get = (file: string) =>
  GET(
    new Request(
      `http://localhost/api/admin/settings/backups/download?file=${encodeURIComponent(file)}`,
    ),
    {},
  );

beforeEach(() => {
  vi.clearAllMocks();
  isValidBackupNameMock.mockReturnValue(true);
  statSyncMock.mockReturnValue({ size: 2048 });
  createReadStreamMock.mockReturnValue(Readable.from(Buffer.from('dump-bytes')));
});

describe('GET /api/admin/settings/backups/download', () => {
  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);
    expect((await get(VALID)).status).toBe(401);
  });

  it('returns 403 and logs a denial for a non-admin', async () => {
    authMock.mockResolvedValue({ user: { id: 'f1', role: 'FACULTY' } });
    const res = await get(VALID);
    expect(res.status).toBe(403);
    expect(activityLogMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ action: 'ADMIN_BACKUP_DOWNLOAD_DENIED', severity: 'SECURITY' }),
    );
  });

  it('returns 400 when the filename fails the allow-list', async () => {
    authMock.mockResolvedValue(admin);
    isValidBackupNameMock.mockReturnValue(false);
    const res = await get('etc-passwd');
    expect(res.status).toBe(400);
    expect(statSyncMock).not.toHaveBeenCalled();
  });

  it('returns 400 when the resolved path escapes the backup directory', async () => {
    // Allow-list bypassed (mocked true) so we exercise the second, path-resolution guard.
    authMock.mockResolvedValue(admin);
    const res = await get('../secrets/afct.dump');
    expect(res.status).toBe(400);
    expect(statSyncMock).not.toHaveBeenCalled();
  });

  it('returns 404 when the backup file does not exist', async () => {
    authMock.mockResolvedValue(admin);
    statSyncMock.mockImplementation(() => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });
    const res = await get(VALID);
    expect(res.status).toBe(404);
  });

  it('streams the file as an attachment and records a SECURITY audit event', async () => {
    authMock.mockResolvedValue(admin);
    const res = await get(VALID);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/octet-stream');
    expect(res.headers.get('Content-Disposition')).toBe(`attachment; filename="${VALID}"`);
    expect(res.headers.get('Content-Length')).toBe('2048');
    expect(activityLogMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        action: 'SYSTEM_BACKUP_DOWNLOADED',
        severity: 'SECURITY',
        metadata: { file: VALID },
      }),
    );
    expect(await res.text()).toBe('dump-bytes');
  });

  it('still streams the file if the audit log write fails', async () => {
    authMock.mockResolvedValue(admin);
    activityLogMock.mockRejectedValue(new Error('db down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await get(VALID);
    expect(res.status).toBe(200);
  });
});
