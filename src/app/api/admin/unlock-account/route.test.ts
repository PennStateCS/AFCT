import { beforeEach, describe, expect, it, vi } from 'vitest';
import { routeCtx } from '@/test/route';

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), update: vi.fn() },
}));
const authMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));

import { POST } from './route';

const post = (body: unknown) =>
  POST(
    new Request('http://localhost/api/admin/unlock-account', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    routeCtx(),
  );

beforeEach(() => {
  vi.clearAllMocks();
  activityLogMock.mockResolvedValue(undefined);
  prismaMock.user.update.mockResolvedValue({});
});

describe('POST /api/admin/unlock-account', () => {
  it('rejects a non-admin', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', isAdmin: false } });
    const res = await post({ userId: 'target' });
    expect(res.status).toBe(403);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('400s without a userId', async () => {
    authMock.mockResolvedValue({ user: { id: 'admin', isAdmin: true } });
    const res = await post({});
    expect(res.status).toBe(400);
  });

  it('404s for an unknown user', async () => {
    authMock.mockResolvedValue({ user: { id: 'admin', isAdmin: true } });
    prismaMock.user.findUnique.mockResolvedValue(null);
    const res = await post({ userId: 'ghost' });
    expect(res.status).toBe(404);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('clears the lock and reports it was locked', async () => {
    authMock.mockResolvedValue({ user: { id: 'admin', isAdmin: true } });
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'target',
      lockedUntil: new Date(Date.now() + 10 * 60_000),
    });

    const res = await post({ userId: 'target' });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ success: true, wasLocked: true });
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 'target' },
      data: { lockedUntil: null },
    });
    expect(activityLogMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ action: 'UNLOCK_ACCOUNT' }),
    );
  });

  it('is idempotent: clearing an already-unlocked account still succeeds', async () => {
    authMock.mockResolvedValue({ user: { id: 'admin', isAdmin: true } });
    prismaMock.user.findUnique.mockResolvedValue({ id: 'target', lockedUntil: null });

    const res = await post({ userId: 'target' });
    const body = await res.json();

    expect(res.status).toBe(200);
    // wasLocked=false so the UI/audit can tell a real unlock from a no-op.
    expect(body).toEqual({ success: true, wasLocked: false });
    expect(prismaMock.user.update).toHaveBeenCalled();
  });

  it('treats an expired lock as not-locked', async () => {
    authMock.mockResolvedValue({ user: { id: 'admin', isAdmin: true } });
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'target',
      lockedUntil: new Date(Date.now() - 1000),
    });

    const body = await (await post({ userId: 'target' })).json();
    expect(body.wasLocked).toBe(false);
  });
});
