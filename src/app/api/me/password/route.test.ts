import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
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

const allowedMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/account-credentials', () => ({ linkedAccountPasswordsAllowed: allowedMock }));
// Mail is a side channel here: the notification must never decide whether the password was set.
vi.mock('@/lib/mailer', () => ({ isMailConfigured: vi.fn().mockResolvedValue(false) }));
vi.mock('@/lib/mail-queue', () => ({ queueMail: vi.fn() }));
vi.mock('@/lib/public-app-url', () => ({ publicAppUrl: (p: string) => `https://afct.test${p}` }));

import { POST } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  bcryptMock.compare.mockReset();
  bcryptMock.hash.mockReset();
  allowedMock.mockReset();
  allowedMock.mockResolvedValue(true);
  prismaMock.user.updateMany.mockReset();
  prismaMock.user.updateMany.mockResolvedValue({ count: 1 });
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
          wasTemporaryPassword: true,
        }),
      }),
    );
  });
});

/**
 * Setting a first password on an account that has none: one created by an institutional
 * sign-in or an LMS launch. The session is the authority, because there is no current password
 * to prove and, on a site with no mail server, no reset link either.
 */
describe('POST /api/me/password, on an account with no password', () => {
  const signedIn = () => authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });
  const noPassword = () =>
    prismaMock.user.findUnique.mockResolvedValue({ password: null, temporaryPassword: false });

  const request = (body: Record<string, unknown>) =>
    new NextRequest('http://localhost/api/me/password', {
      method: 'POST',
      body: JSON.stringify(body),
    });

  it('sets one without a current password', async () => {
    signedIn();
    noPassword();
    bcryptMock.hash.mockResolvedValue('hashed');

    const res = await POST(request({ newPassword: 'Newpassword1!' }));

    expect(res.status).toBe(200);
    expect(prismaMock.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'u1', password: null },
        data: expect.objectContaining({ password: 'hashed', temporaryPassword: false }),
      }),
    );
  });

  /**
   * The one that matters most. `passwordChangedAt` means "revoke everything issued before the
   * credential changed", and nothing changed here. Stamping it would sign this person out of
   * the session they are using and reject the app token they may just have made.
   */
  it('does not stamp passwordChangedAt, so nothing already issued is revoked', async () => {
    signedIn();
    noPassword();
    bcryptMock.hash.mockResolvedValue('hashed');

    await POST(request({ newPassword: 'Newpassword1!' }));

    const data = prismaMock.user.updateMany.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('passwordChangedAt');
  });

  it('logs it as its own action, at SECURITY', async () => {
    signedIn();
    noPassword();
    bcryptMock.hash.mockResolvedValue('hashed');

    const req = request({ newPassword: 'Newpassword1!' });
    await POST(req);

    expect(activityLogMock).toHaveBeenCalledWith(
      prismaMock,
      req,
      expect.objectContaining({ action: 'SET_PASSWORD', severity: 'SECURITY' }),
    );
  });

  it('refuses when the site does not allow it, without naming a reset link', async () => {
    signedIn();
    noPassword();
    allowedMock.mockResolvedValue(false);

    const res = await POST(request({ newPassword: 'Newpassword1!' }));

    expect(res.status).toBe(403);
    expect(prismaMock.user.updateMany).not.toHaveBeenCalled();
    const body = (await res.json()) as { error: string };
    // On a site with no mail server there is no reset link, so sending anybody to one is
    // advice that cannot be followed.
    expect(body.error).not.toMatch(/reset/i);
    expect(body.error).toMatch(/administrator/i);
  });

  it('still applies the strength policy', async () => {
    signedIn();
    noPassword();

    const res = await POST(request({ newPassword: 'weak' }));

    expect(res.status).toBe(400);
    expect(prismaMock.user.updateMany).not.toHaveBeenCalled();
  });

  /**
   * The conditional write, which is what stops an administrator's temporary password being
   * silently clobbered by a set that was already in flight. `count: 0` is the database saying
   * somebody got there first.
   */
  it('answers 409 when a password appeared while the request was in flight', async () => {
    signedIn();
    noPassword();
    bcryptMock.hash.mockResolvedValue('hashed');
    prismaMock.user.updateMany.mockResolvedValue({ count: 0 });

    const res = await POST(request({ newPassword: 'Newpassword1!' }));

    expect(res.status).toBe(409);
    expect(activityLogMock).not.toHaveBeenCalledWith(
      prismaMock,
      expect.anything(),
      expect.objectContaining({ action: 'SET_PASSWORD' }),
    );
  });

  /**
   * The guard that must not regress: omitting `oldPassword` is not a way past the check for an
   * account that has one. Which branch runs is read from the account, never from the body.
   */
  it('does not let an account WITH a password skip the check by omitting the field', async () => {
    signedIn();
    prismaMock.user.findUnique.mockResolvedValue({
      password: 'existing-hash',
      temporaryPassword: false,
    });

    const res = await POST(request({ newPassword: 'Newpassword1!' }));

    expect(res.status).toBe(400);
    expect(prismaMock.user.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });
});
