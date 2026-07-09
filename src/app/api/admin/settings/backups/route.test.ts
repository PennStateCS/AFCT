import { beforeEach, describe, expect, it, vi } from 'vitest';

const authMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());
const listBackupsMock = vi.hoisted(() => vi.fn());
const mkdirSyncMock = vi.hoisted(() => vi.fn());
const writeFileSyncMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));
vi.mock('@/lib/backups', () => ({
  listBackups: listBackupsMock,
  BACKUP_TRIGGER_DIR: '/backup-triggers',
  BACKUP_TRIGGER_FILE: '/backup-triggers/backup-now',
}));
vi.mock('fs', () => {
  const api = { mkdirSync: mkdirSyncMock, writeFileSync: writeFileSyncMock };
  return { default: api, ...api };
});

import { GET, POST } from './route';

const admin = { user: { id: 'a1', role: 'ADMIN', isAdmin: true } };
const req = (method = 'GET') =>
  new Request('http://localhost/api/admin/settings/backups', { method });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/admin/settings/backups', () => {
  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);
    expect((await GET(req(), {})).status).toBe(401);
  });

  it('returns 403 and logs a denial for a non-admin', async () => {
    authMock.mockResolvedValue({ user: { id: 'f1', role: 'FACULTY' } });
    const res = await GET(req(), {});
    expect(res.status).toBe(403);
    expect(activityLogMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ action: 'ADMIN_BACKUPS_VIEW_DENIED', severity: 'SECURITY' }),
    );
  });

  it('returns the backup list for an admin', async () => {
    authMock.mockResolvedValue(admin);
    listBackupsMock.mockReturnValue([{ timestamp: '20260101-000000', dumpFile: 'afct.dump' }]);
    const res = await GET(req(), {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.backups).toHaveLength(1);
    expect(listBackupsMock).toHaveBeenCalled();
  });
});

describe('POST /api/admin/settings/backups', () => {
  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);
    expect((await POST(req('POST'), {})).status).toBe(401);
  });

  it('returns 403 and logs a denial for a non-admin', async () => {
    authMock.mockResolvedValue({ user: { id: 'f1', role: 'FACULTY' } });
    const res = await POST(req('POST'), {});
    expect(res.status).toBe(403);
    expect(activityLogMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ action: 'ADMIN_BACKUP_TRIGGER_DENIED', severity: 'SECURITY' }),
    );
  });

  it('drops the trigger file and returns 202 with an audit log', async () => {
    authMock.mockResolvedValue(admin);
    const res = await POST(req('POST'), {});
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ ok: true });
    expect(mkdirSyncMock).toHaveBeenCalledWith('/backup-triggers', { recursive: true });
    expect(writeFileSyncMock).toHaveBeenCalledWith(
      '/backup-triggers/backup-now',
      expect.any(String),
    );
    expect(activityLogMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ action: 'SYSTEM_BACKUP_REQUESTED' }),
    );
  });

  it('returns 503 when the trigger volume is not mounted', async () => {
    authMock.mockResolvedValue(admin);
    writeFileSyncMock.mockImplementationOnce(() => {
      throw new Error('ENOENT: no such directory');
    });
    const res = await POST(req('POST'), {});
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'Backup service is not available' });
  });

  it('still returns 202 if the audit log write fails', async () => {
    authMock.mockResolvedValue(admin);
    activityLogMock.mockRejectedValue(new Error('db down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await POST(req('POST'), {});
    expect(res.status).toBe(202);
  });
});
