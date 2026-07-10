import { beforeEach, describe, expect, it, vi } from 'vitest';
import { routeCtx } from '@/test/route';

const prismaMock = vi.hoisted(() => ({
  user: { update: vi.fn() },
}));

const authMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());
const bcryptMock = vi.hoisted(() => ({ hash: vi.fn() }));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));
vi.mock('bcrypt', async (importOriginal) => {
  const actual = await importOriginal<typeof import('bcrypt')>();
  return {
    ...actual,
    ...bcryptMock,
    default: {
      ...actual,
      ...bcryptMock,
    },
  };
});

import { POST } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  bcryptMock.hash.mockResolvedValue('hashed');
});

describe('POST /api/admin/reset-password', () => {
  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);

    const req = new Request('http://localhost/api/admin/reset-password', {
      method: 'POST',
      body: JSON.stringify({ userId: 'u1', newPassword: 'Strong1!a' }),
    });

    const res = await POST(req, routeCtx());

    expect(res.status).toBe(401);
  });

  it('returns 400 when fields missing', async () => {
    authMock.mockResolvedValue({ user: { id: 'admin', isAdmin: true } });

    const req = new Request('http://localhost/api/admin/reset-password', {
      method: 'POST',
      body: JSON.stringify({ userId: 'u1' }),
    });

    const res = await POST(req, routeCtx());

    expect(res.status).toBe(400);
  });

  it('returns 400 when password weak', async () => {
    authMock.mockResolvedValue({ user: { id: 'admin', isAdmin: true } });

    const req = new Request('http://localhost/api/admin/reset-password', {
      method: 'POST',
      body: JSON.stringify({ userId: 'u1', newPassword: 'weak' }),
    });

    const res = await POST(req, routeCtx());

    expect(res.status).toBe(400);
  });

  it('resets password and logs activity', async () => {
    authMock.mockResolvedValue({ user: { id: 'admin', isAdmin: true } });
    prismaMock.user.update.mockResolvedValue({ id: 'u1' });

    const req = new Request('http://localhost/api/admin/reset-password', {
      method: 'POST',
      body: JSON.stringify({ userId: 'u1', newPassword: 'Strong1!a', isTemporary: true }),
    });

    const res = await POST(req, routeCtx());

    expect(res.status).toBe(200);
    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ temporaryPassword: true }),
      }),
    );
    expect(activityLogMock).toHaveBeenCalledWith(
      prismaMock,
      req,
      expect.objectContaining({
        action: 'RESET_PASSWORD',
        metadata: expect.objectContaining({
          userId: 'admin',
          targetUserId: 'u1',
          temporaryPassword: true,
        }),
      }),
    );
  });

  it('returns 500 and logs an error when the update fails', async () => {
    authMock.mockResolvedValue({ user: { id: 'admin', isAdmin: true } });
    prismaMock.user.update.mockRejectedValueOnce(new Error('db down'));

    const req = new Request('http://localhost/api/admin/reset-password', {
      method: 'POST',
      body: JSON.stringify({ userId: 'u1', newPassword: 'Strong1!a' }),
    });

    const res = await POST(req, routeCtx());

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('Failed to reset password');
    expect(activityLogMock).toHaveBeenCalledWith(
      prismaMock,
      req,
      expect.objectContaining({
        action: 'ADMIN_RESET_PASSWORD_ERROR',
        severity: 'ERROR',
        metadata: expect.objectContaining({ error: 'db down' }),
      }),
    );
  });

  it('logs "unknown error" when a non-Error value is thrown', async () => {
    authMock.mockResolvedValue({ user: { id: 'admin', isAdmin: true } });
    prismaMock.user.update.mockRejectedValueOnce('a plain string');

    const req = new Request('http://localhost/api/admin/reset-password', {
      method: 'POST',
      body: JSON.stringify({ userId: 'u1', newPassword: 'Strong1!a' }),
    });

    const res = await POST(req, routeCtx());

    expect(res.status).toBe(500);
    expect(activityLogMock).toHaveBeenCalledWith(
      prismaMock,
      req,
      expect.objectContaining({
        action: 'ADMIN_RESET_PASSWORD_ERROR',
        metadata: expect.objectContaining({ error: 'unknown error' }),
      }),
    );
  });
});
