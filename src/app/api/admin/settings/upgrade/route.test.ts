import { beforeEach, describe, expect, it, vi } from 'vitest';

const authMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());
const updatesMock = vi.hoisted(() => ({
  currentVersion: vi.fn(() => 'v1.0.0'),
  fetchManifest: vi.fn(),
  isValidTag: vi.fn(() => true),
  isValidRestorePoint: vi.fn(() => true),
  readStatus: vi.fn(() => null),
  updaterAvailable: vi.fn(() => true),
  updaterVersion: vi.fn(() => ''),
  updaterReadiness: vi.fn(() => null),
  readRestorePoints: vi.fn(
    (): Array<{ version: string; backup: string; createdAt?: string }> => [],
  ),
  writeUpdateRequest: vi.fn(),
  writeDowngradeRequest: vi.fn(),
  writeSelfUpdateRequest: vi.fn(),
  writeDeleteRestorePointRequest: vi.fn(),
  // Pass restore points through unchanged; the join is covered in updates.test.ts.
  withBackupDetails: vi.fn((points: unknown) => points),
}));

vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));
vi.mock('@/lib/updates', () => updatesMock);
vi.mock('@/lib/backups', () => ({ listBackups: vi.fn(() => []) }));
// The GET handler reconciles a finished run's outcome into the activity log; that has
// its own tests (update-audit.test.ts), so stub it out here.
vi.mock('@/lib/update-audit', () => ({ reconcileUpdateOutcomeLog: vi.fn() }));

import { GET, POST } from './route';
import { routeCtx } from '@/test/route';

const admin = { user: { id: 'a1', isAdmin: true } };
const req = (method = 'GET', body?: unknown) =>
  new Request('http://localhost/api/admin/settings/upgrade', {
    method,
    ...(body !== undefined
      ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }
      : {}),
  });

beforeEach(() => {
  vi.clearAllMocks();
  // clearAllMocks clears call history but NOT implementations, so reset the fns a
  // test may have stubbed to throw (writeUpdateRequest, fetchManifest below).
  updatesMock.writeUpdateRequest.mockReset();
  updatesMock.writeDowngradeRequest.mockReset();
  updatesMock.writeSelfUpdateRequest.mockReset();
  updatesMock.writeDeleteRestorePointRequest.mockReset();
  authMock.mockResolvedValue(admin);
  updatesMock.currentVersion.mockReturnValue('v1.0.0');
  updatesMock.isValidTag.mockReturnValue(true);
  updatesMock.isValidRestorePoint.mockReturnValue(true);
  updatesMock.readStatus.mockReturnValue(null);
  updatesMock.readRestorePoints.mockReturnValue([]);
  updatesMock.fetchManifest.mockResolvedValue({
    versions: [{ tag: 'v1.0.0' }, { tag: 'v1.1.0' }],
  });
});

describe('GET /api/admin/settings/upgrade', () => {
  it('401 without a session, 403 for a non-admin', async () => {
    authMock.mockResolvedValue(null);
    expect((await GET(req(), routeCtx())).status).toBe(401);
    authMock.mockResolvedValue({ user: { id: 'u', isAdmin: false } });
    expect((await GET(req(), routeCtx())).status).toBe(403);
  });

  it('returns the current version, available releases, and status', async () => {
    const res = await GET(req(), routeCtx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.current).toBe('v1.0.0');
    expect(body.versions.map((v: { tag: string }) => v.tag)).toEqual(['v1.0.0', 'v1.1.0']);
    expect(body.manifestError).toBe(false);
    expect(body.updaterAvailable).toBe(true);
  });

  it('reports updaterAvailable=false when the sidecar heartbeat is absent', async () => {
    updatesMock.updaterAvailable.mockReturnValue(false);
    const body = await (await GET(req(), routeCtx())).json();
    expect(body.updaterAvailable).toBe(false);
  });

  // Running and current is not the same as able to upgrade; the tab needs the difference.
  it('passes the updater self-report through so the tab can warn about a stale one', async () => {
    updatesMock.updaterReadiness.mockReturnValue({
      envFile: '/afct/.env.production',
      composeFile: '/afct-compose/docker-compose.yml',
      envFileOk: false,
      composeFileOk: true,
    } as never);
    const body = await (await GET(req(), routeCtx())).json();
    expect(body.updaterReadiness).toEqual({
      envFile: '/afct/.env.production',
      composeFile: '/afct-compose/docker-compose.yml',
      envFileOk: false,
      composeFileOk: true,
    });
  });

  it('degrades gracefully when the manifest cannot be fetched', async () => {
    updatesMock.fetchManifest.mockRejectedValue(new Error('offline'));
    const body = await (await GET(req(), routeCtx())).json();
    expect(body.manifestError).toBe(true);
    expect(body.versions).toEqual([]);
    expect(body.current).toBe('v1.0.0');
  });
});

describe('POST /api/admin/settings/upgrade', () => {
  it('403 for a non-admin, and no request is written', async () => {
    authMock.mockResolvedValue({ user: { id: 'u', isAdmin: false } });
    expect((await POST(req('POST', { tag: 'v1.1.0' }), routeCtx())).status).toBe(403);
    expect(updatesMock.writeUpdateRequest).not.toHaveBeenCalled();
  });

  it('rejects an invalid tag', async () => {
    updatesMock.isValidTag.mockReturnValue(false);
    const res = await POST(req('POST', { tag: 'bad tag' }), routeCtx());
    expect(res.status).toBe(400);
    expect(updatesMock.writeUpdateRequest).not.toHaveBeenCalled();
  });

  it('rejects a tag that is not a curated release', async () => {
    const res = await POST(req('POST', { tag: 'v9.9.9' }), routeCtx());
    expect(res.status).toBe(400);
    expect(updatesMock.writeUpdateRequest).not.toHaveBeenCalled();
  });

  it('rejects upgrading to the version already running', async () => {
    const res = await POST(req('POST', { tag: 'v1.0.0' }), routeCtx());
    expect(res.status).toBe(400);
    expect(updatesMock.writeUpdateRequest).not.toHaveBeenCalled();
  });

  it('requests a self-update for the running version', async () => {
    const res = await POST(req('POST', { action: 'self-update', tag: 'v1.0.0' }), routeCtx());
    expect(res.status).toBe(202);
    expect(updatesMock.writeSelfUpdateRequest).toHaveBeenCalledWith(
      expect.objectContaining({ tag: 'v1.0.0' }),
    );
  });

  it('rejects a self-update to a version other than the running one', async () => {
    const res = await POST(req('POST', { action: 'self-update', tag: 'v1.1.0' }), routeCtx());
    expect(res.status).toBe(400);
    expect(updatesMock.writeSelfUpdateRequest).not.toHaveBeenCalled();
  });

  it('503 when the release list cannot be verified', async () => {
    updatesMock.fetchManifest.mockRejectedValue(new Error('offline'));
    const res = await POST(req('POST', { tag: 'v1.1.0' }), routeCtx());
    expect(res.status).toBe(503);
    expect(updatesMock.writeUpdateRequest).not.toHaveBeenCalled();
  });

  it('503 when the updater trigger volume is not mounted', async () => {
    updatesMock.writeUpdateRequest.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    const res = await POST(req('POST', { tag: 'v1.1.0' }), routeCtx());
    expect(res.status).toBe(503);
  });

  it('writes a request, audit-logs, and returns 202 on a valid upgrade', async () => {
    const res = await POST(req('POST', { tag: 'v1.1.0' }), routeCtx());
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(typeof body.requestId).toBe('string');
    expect(updatesMock.writeUpdateRequest).toHaveBeenCalledWith(
      expect.objectContaining({ tag: 'v1.1.0', requestedBy: 'a1' }),
    );
    expect(activityLogMock).toHaveBeenCalledWith(
      {},
      expect.anything(),
      expect.objectContaining({ action: 'SYSTEM_UPDATE_REQUESTED' }),
    );
  });
});

describe('POST downgrade', () => {
  const downgrade = (body: Record<string, unknown>) =>
    POST(req('POST', { action: 'downgrade', ...body }), routeCtx());

  it('rejects a downgrade with no/invalid restore point', async () => {
    updatesMock.isValidRestorePoint.mockReturnValue(false);
    const res = await downgrade({ tag: 'v0.9.0', restorePoint: 'bad' });
    expect(res.status).toBe(400);
    expect(updatesMock.writeDowngradeRequest).not.toHaveBeenCalled();
  });

  it('rejects a restore point that is not recorded for that version', async () => {
    updatesMock.readRestorePoints.mockReturnValue([
      { version: 'v0.8.0', backup: '20260101-000000' },
    ]);
    const res = await downgrade({ tag: 'v0.9.0', restorePoint: '20260101-000000' });
    expect(res.status).toBe(400);
    expect(updatesMock.writeDowngradeRequest).not.toHaveBeenCalled();
  });

  it('writes a downgrade request and audit-logs it (WARNING) on a valid restore point', async () => {
    updatesMock.readRestorePoints.mockReturnValue([
      { version: 'v0.9.0', backup: '20260101-000000' },
    ]);
    const res = await downgrade({ tag: 'v0.9.0', restorePoint: '20260101-000000' });
    expect(res.status).toBe(202);
    expect(updatesMock.writeDowngradeRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        tag: 'v0.9.0',
        restorePoint: '20260101-000000',
        requestedBy: 'a1',
        force: false,
      }),
    );
    // A downgrade does NOT go through the release manifest.
    expect(updatesMock.fetchManifest).not.toHaveBeenCalled();
    expect(activityLogMock).toHaveBeenCalledWith(
      {},
      expect.anything(),
      expect.objectContaining({ action: 'SYSTEM_DOWNGRADE_REQUESTED', severity: 'WARNING' }),
    );
    expect(activityLogMock).toHaveBeenCalledWith(
      {},
      expect.anything(),
      expect.objectContaining({ metadata: expect.objectContaining({ forced: false }) }),
    );
  });

  it('passes force through and records it in the audit log when the downgrade is forced', async () => {
    updatesMock.readRestorePoints.mockReturnValue([
      { version: 'v0.9.0', backup: '20260101-000000' },
    ]);
    const res = await downgrade({ tag: 'v0.9.0', restorePoint: '20260101-000000', force: true });
    expect(res.status).toBe(202);
    expect(updatesMock.writeDowngradeRequest).toHaveBeenCalledWith(
      expect.objectContaining({ tag: 'v0.9.0', force: true }),
    );
    expect(activityLogMock).toHaveBeenCalledWith(
      {},
      expect.anything(),
      expect.objectContaining({ metadata: expect.objectContaining({ forced: true }) }),
    );
  });

  it('403 for a non-admin, and no request is written', async () => {
    authMock.mockResolvedValue({ user: { id: 'u', isAdmin: false } });
    const res = await downgrade({ tag: 'v0.9.0', restorePoint: '20260101-000000' });
    expect(res.status).toBe(403);
    expect(updatesMock.writeDowngradeRequest).not.toHaveBeenCalled();
  });
});

describe('POST delete-restore-point', () => {
  const del = (body: Record<string, unknown>) =>
    POST(req('POST', { action: 'delete-restore-point', ...body }), routeCtx());

  it('rejects an invalid restore point', async () => {
    updatesMock.isValidRestorePoint.mockReturnValue(false);
    const res = await del({ restorePoint: 'bad' });
    expect(res.status).toBe(400);
    expect(updatesMock.writeDeleteRestorePointRequest).not.toHaveBeenCalled();
  });

  it('rejects a restore point that is not recorded (no arbitrary deletes)', async () => {
    updatesMock.readRestorePoints.mockReturnValue([
      { version: 'v0.9.0', backup: '20260101-000000' },
    ]);
    const res = await del({ restorePoint: '19990101-000000' });
    expect(res.status).toBe(400);
    expect(updatesMock.writeDeleteRestorePointRequest).not.toHaveBeenCalled();
  });

  it('writes a delete request and audit-logs it on a recorded restore point', async () => {
    updatesMock.readRestorePoints.mockReturnValue([
      { version: 'v0.9.0', backup: '20260101-000000' },
    ]);
    const res = await del({ restorePoint: '20260101-000000' });
    expect(res.status).toBe(202);
    expect(updatesMock.writeDeleteRestorePointRequest).toHaveBeenCalledWith(
      expect.objectContaining({ restorePoint: '20260101-000000', requestedBy: 'a1' }),
    );
    // No tag needed, so the release manifest is never consulted.
    expect(updatesMock.fetchManifest).not.toHaveBeenCalled();
    expect(activityLogMock).toHaveBeenCalledWith(
      {},
      expect.anything(),
      expect.objectContaining({ action: 'SYSTEM_RESTORE_POINT_DELETE_REQUESTED' }),
    );
  });
});
