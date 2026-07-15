import { beforeEach, describe, expect, it, vi } from 'vitest';

const authMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());
const updatesMock = vi.hoisted(() => ({
  currentVersion: vi.fn(() => 'v1.0.0'),
  fetchManifest: vi.fn(),
  isValidTag: vi.fn(() => true),
  readStatus: vi.fn(() => null),
  writeUpdateRequest: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));
vi.mock('@/lib/updates', () => updatesMock);

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
  authMock.mockResolvedValue(admin);
  updatesMock.currentVersion.mockReturnValue('v1.0.0');
  updatesMock.isValidTag.mockReturnValue(true);
  updatesMock.readStatus.mockReturnValue(null);
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
