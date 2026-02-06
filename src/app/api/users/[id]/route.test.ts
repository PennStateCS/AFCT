import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
  roster: { findMany: vi.fn() },
  activityLog: { deleteMany: vi.fn() },
}));

const authMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());
const getSystemUploadLimitMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));
vi.mock('@/lib/upload-limits', () => ({ getSystemUploadLimit: getSystemUploadLimitMock }));
vi.mock('fs/promises', () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  unlink: vi.fn().mockResolvedValue(undefined),
}));

import { PATCH, DELETE } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  getSystemUploadLimitMock.mockResolvedValue({ maxBytes: 1024 * 1024, maxMb: 1 });
});

describe('PATCH /api/users/[id]', () => {
  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/users/u1', {
      method: 'PATCH',
      body: JSON.stringify({ firstName: 'A' }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: 'u1' }) });

    expect(res.status).toBe(401);
  });

  it('returns 403 when forbidden', async () => {
    authMock.mockResolvedValue({ user: { id: 'u2', role: 'STUDENT' } });

    const req = new NextRequest('http://localhost/api/users/u1', {
      method: 'PATCH',
      body: JSON.stringify({ firstName: 'A' }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: 'u1' }) });

    expect(res.status).toBe(403);
  });

  it('returns 400 when timezone invalid', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });

    const req = new NextRequest('http://localhost/api/users/u1', {
      method: 'PATCH',
      body: JSON.stringify({ timezone: 'Invalid/Zone' }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: 'u1' }) });

    expect(res.status).toBe(400);
  });

  it('updates user and logs activity', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    prismaMock.user.findUnique.mockResolvedValue({ avatar: null });
    prismaMock.user.update.mockResolvedValue({
      id: 'u1',
      email: 'u1@example.com',
      firstName: 'A',
      lastName: 'B',
      role: 'ADMIN',
      inactive: false,
      avatar: null,
      timezone: 'America/New_York',
    });

    const req = new NextRequest('http://localhost/api/users/u1', {
      method: 'PATCH',
      body: JSON.stringify({ firstName: 'A', lastName: 'B', timezone: 'America/New_York' }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: 'u1' }) });

    expect(res.status).toBe(200);
    expect(prismaMock.user.update).toHaveBeenCalled();
    expect(activityLogMock).toHaveBeenCalled();
  });
});

describe('DELETE /api/users/[id]', () => {
  it('returns 403 when forbidden', async () => {
    authMock.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/users/u1', { method: 'DELETE' });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'u1' }) });

    expect(res.status).toBe(403);
  });

  it('deletes user and logs activity', async () => {
    authMock.mockResolvedValue({ user: { id: 'admin', role: 'ADMIN' } });
    prismaMock.user.findUnique.mockResolvedValue({ avatar: 'avatar.png' });

    const req = new NextRequest('http://localhost/api/users/u1', { method: 'DELETE' });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'u1' }) });

    expect(res.status).toBe(200);
    expect(prismaMock.user.delete).toHaveBeenCalled();
    expect(activityLogMock).toHaveBeenCalled();
  });
});
