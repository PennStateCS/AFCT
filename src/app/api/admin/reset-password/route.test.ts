import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  it('returns 403 when unauthorized', async () => {
    authMock.mockResolvedValue(null);

    const req = new Request('http://localhost/api/admin/reset-password', {
      method: 'POST',
      body: JSON.stringify({ userId: 'u1', newPassword: 'Strong1!a' }),
    });

    const res = await POST(req);

    expect(res.status).toBe(403);
  });

  it('returns 400 when fields missing', async () => {
    authMock.mockResolvedValue({ user: { id: 'admin', role: 'ADMIN', isAdmin: true } });

    const req = new Request('http://localhost/api/admin/reset-password', {
      method: 'POST',
      body: JSON.stringify({ userId: 'u1' }),
    });

    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  it('returns 400 when password weak', async () => {
    authMock.mockResolvedValue({ user: { id: 'admin', role: 'ADMIN', isAdmin: true } });

    const req = new Request('http://localhost/api/admin/reset-password', {
      method: 'POST',
      body: JSON.stringify({ userId: 'u1', newPassword: 'weak' }),
    });

    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  it('resets password and logs activity', async () => {
    authMock.mockResolvedValue({ user: { id: 'admin', role: 'ADMIN', isAdmin: true } });
    prismaMock.user.update.mockResolvedValue({ id: 'u1' });

    const req = new Request('http://localhost/api/admin/reset-password', {
      method: 'POST',
      body: JSON.stringify({ userId: 'u1', newPassword: 'Strong1!a', isTemporary: true }),
    });

    const res = await POST(req);

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
          initiatedByRole: 'ADMIN',
          targetUserId: 'u1',
          temporaryPassword: true,
        }),
      }),
    );
  });
});
