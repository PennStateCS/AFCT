import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), update: vi.fn() },
}));

const authMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());
const bcryptMock = vi.hoisted(() => ({
  compare: vi.fn(),
  hash: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));
vi.mock('bcrypt', () => ({ default: bcryptMock }));

import { POST } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  bcryptMock.compare.mockReset();
  bcryptMock.hash.mockReset();
});

describe('POST /api/users/change-password', () => {
  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/users/change-password', {
      method: 'POST',
      body: JSON.stringify({ oldPassword: 'old', newPassword: 'newpassword' }),
    });

    const res = await POST(req);

    expect(res.status).toBe(401);
  });

  it('returns 403 when role forbidden', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'GUEST' } });

    const req = new NextRequest('http://localhost/api/users/change-password', {
      method: 'POST',
      body: JSON.stringify({ oldPassword: 'old', newPassword: 'newpassword' }),
    });

    const res = await POST(req);

    expect(res.status).toBe(403);
  });

  it('returns 400 when missing fields', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });

    const req = new NextRequest('http://localhost/api/users/change-password', {
      method: 'POST',
      body: JSON.stringify({ oldPassword: 'old' }),
    });

    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  it('returns 400 when new password too short', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });

    const req = new NextRequest('http://localhost/api/users/change-password', {
      method: 'POST',
      body: JSON.stringify({ oldPassword: 'old', newPassword: 'short' }),
    });

    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  it('returns 404 when user missing', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });
    prismaMock.user.findUnique.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/users/change-password', {
      method: 'POST',
      body: JSON.stringify({ oldPassword: 'oldpass', newPassword: 'newpassword' }),
    });

    const res = await POST(req);

    expect(res.status).toBe(404);
  });

  it('returns 400 when old password incorrect', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });
    prismaMock.user.findUnique.mockResolvedValue({ password: 'hash' });
    bcryptMock.compare.mockResolvedValue(false);

    const req = new NextRequest('http://localhost/api/users/change-password', {
      method: 'POST',
      body: JSON.stringify({ oldPassword: 'oldpass', newPassword: 'newpassword' }),
    });

    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  it('returns 400 when new password same as old', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });
    prismaMock.user.findUnique.mockResolvedValue({ password: 'hash' });
    bcryptMock.compare.mockResolvedValueOnce(true).mockResolvedValueOnce(true);

    const req = new NextRequest('http://localhost/api/users/change-password', {
      method: 'POST',
      body: JSON.stringify({ oldPassword: 'oldpass', newPassword: 'oldpass' }),
    });

    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  it('updates password and logs activity', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });
    prismaMock.user.findUnique.mockResolvedValue({ password: 'hash' });
    bcryptMock.compare.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    bcryptMock.hash.mockResolvedValue('newhash');

    const req = new NextRequest('http://localhost/api/users/change-password', {
      method: 'POST',
      body: JSON.stringify({ oldPassword: 'oldpass', newPassword: 'newpassword' }),
    });

    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(prismaMock.user.update).toHaveBeenCalled();
    expect(activityLogMock).toHaveBeenCalled();
  });
});
