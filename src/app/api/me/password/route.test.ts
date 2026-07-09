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

describe('POST /api/me/password', () => {
  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/me/password', {
      method: 'POST',
      body: JSON.stringify({ oldPassword: 'old', newPassword: 'Newpassword1!' }),
    });

    const res = await POST(req);

    expect(res.status).toBe(401);
  });

  it('returns 400 when missing fields', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });

    const req = new NextRequest('http://localhost/api/me/password', {
      method: 'POST',
      body: JSON.stringify({ oldPassword: 'old' }),
    });

    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  it('returns 400 when new password too short', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });

    const req = new NextRequest('http://localhost/api/me/password', {
      method: 'POST',
      body: JSON.stringify({ oldPassword: 'old', newPassword: 'short' }),
    });

    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  it('returns 400 when new password lacks a special character', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });

    const req = new NextRequest('http://localhost/api/me/password', {
      method: 'POST',
      body: JSON.stringify({ oldPassword: 'Oldpass1!', newPassword: 'Newpassword1' }),
    });

    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  it('returns 404 when user missing', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });
    prismaMock.user.findUnique.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/me/password', {
      method: 'POST',
      body: JSON.stringify({ oldPassword: 'oldpass', newPassword: 'Newpassword1!' }),
    });

    const res = await POST(req);

    expect(res.status).toBe(404);
  });

  it('returns 400 when old password incorrect', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });
    prismaMock.user.findUnique.mockResolvedValue({ password: 'hash' });
    bcryptMock.compare.mockResolvedValue(false);

    const req = new NextRequest('http://localhost/api/me/password', {
      method: 'POST',
      body: JSON.stringify({ oldPassword: 'oldpass', newPassword: 'Newpassword1!' }),
    });

    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  it('returns 400 when new password same as old', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });
    prismaMock.user.findUnique.mockResolvedValue({ password: 'hash' });
    bcryptMock.compare.mockResolvedValueOnce(true).mockResolvedValueOnce(true);

    const req = new NextRequest('http://localhost/api/me/password', {
      method: 'POST',
      body: JSON.stringify({ oldPassword: 'oldpass', newPassword: 'oldpass' }),
    });

    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  it('returns 400 when a strong new password matches the current one', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });
    prismaMock.user.findUnique.mockResolvedValue({ password: 'hash' });
    // First compare: old password correct. Second compare: new === old.
    bcryptMock.compare.mockResolvedValueOnce(true).mockResolvedValueOnce(true);

    const req = new NextRequest('http://localhost/api/me/password', {
      method: 'POST',
      body: JSON.stringify({ oldPassword: 'Newpassword1!', newPassword: 'Newpassword1!' }),
    });

    const res = await POST(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('New password cannot be the same as the old password');
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('returns 500 and logs when the update throws', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });
    prismaMock.user.findUnique.mockResolvedValue({ password: 'hash', temporaryPassword: false });
    bcryptMock.compare.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    bcryptMock.hash.mockResolvedValue('newhash');
    prismaMock.user.update.mockRejectedValueOnce(new Error('db down'));

    const req = new NextRequest('http://localhost/api/me/password', {
      method: 'POST',
      body: JSON.stringify({ oldPassword: 'oldpass', newPassword: 'Newpassword1!' }),
    });

    const res = await POST(req);

    expect(res.status).toBe(500);
    expect(activityLogMock).toHaveBeenCalledWith(
      prismaMock,
      req,
      expect.objectContaining({ action: 'CHANGE_PASSWORD_ERROR', severity: 'ERROR' }),
    );
  });

  it('returns 500 with a generic error message when a non-Error is thrown', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });
    prismaMock.user.findUnique.mockResolvedValue({ password: 'hash', temporaryPassword: false });
    bcryptMock.compare.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    bcryptMock.hash.mockResolvedValue('newhash');
    prismaMock.user.update.mockRejectedValueOnce('boom');

    const req = new NextRequest('http://localhost/api/me/password', {
      method: 'POST',
      body: JSON.stringify({ oldPassword: 'oldpass', newPassword: 'Newpassword1!' }),
    });

    const res = await POST(req);

    expect(res.status).toBe(500);
    expect(activityLogMock).toHaveBeenCalledWith(
      prismaMock,
      req,
      expect.objectContaining({
        action: 'CHANGE_PASSWORD_ERROR',
        metadata: expect.objectContaining({ error: 'unknown error' }),
      }),
    );
  });

  it('updates password and logs activity', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });
    prismaMock.user.findUnique.mockResolvedValue({ password: 'hash', temporaryPassword: true });
    bcryptMock.compare.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    bcryptMock.hash.mockResolvedValue('newhash');

    const req = new NextRequest('http://localhost/api/me/password', {
      method: 'POST',
      body: JSON.stringify({ oldPassword: 'oldpass', newPassword: 'Newpassword1!' }),
    });

    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ temporaryPassword: false }),
      }),
    );
    expect(activityLogMock).toHaveBeenCalledWith(
      prismaMock,
      req,
      expect.objectContaining({
        action: 'CHANGE_PASSWORD',
        metadata: expect.objectContaining({
          userId: 'u1',
          wasTemporaryPassword: true,
          clearedTemporaryPassword: true,
        }),
      }),
    );
  });
});
