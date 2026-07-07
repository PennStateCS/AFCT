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
const parseRoleMock = vi.hoisted(() => vi.fn());
const writeFileMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const unlinkMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));
vi.mock('@/lib/upload-limits', () => ({ getSystemUploadLimit: getSystemUploadLimitMock }));
vi.mock('@/lib/roles', () => ({ parseRole: parseRoleMock }));
vi.mock('fs/promises', () => ({
  writeFile: writeFileMock,
  unlink: unlinkMock,
}));

import { PATCH, DELETE, GET, POST } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  getSystemUploadLimitMock.mockResolvedValue({ maxBytes: 1024 * 1024, maxMb: 1 });
  parseRoleMock.mockReturnValue(undefined);
  prismaMock.roster.findMany.mockResolvedValue([]);
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

  it('returns 401 when session has no user', async () => {
    authMock.mockResolvedValue({ user: null });

    const req = new NextRequest('http://localhost/api/users/u1', {
      method: 'PATCH',
      body: JSON.stringify({ firstName: 'A' }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: 'u1' }) });

    expect(res.status).toBe(401);
  });

  it('returns 401 when user has no id', async () => {
    authMock.mockResolvedValue({ user: { email: 'test@test.com' } });

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

  it('allows ADMIN to update any user', async () => {
    authMock.mockResolvedValue({ user: { id: 'admin', role: 'ADMIN', isAdmin: true } });
    prismaMock.user.findUnique.mockResolvedValue({ avatar: null });
    prismaMock.user.update.mockResolvedValue({
      id: 'u1',
      email: 'u1@example.com',
      firstName: 'Updated',
      lastName: 'User',
      role: 'STUDENT',
      inactive: false,
      avatar: null,
      timezone: null,
    });

    const req = new NextRequest('http://localhost/api/users/u1', {
      method: 'PATCH',
      body: JSON.stringify({ firstName: 'Updated', lastName: 'User' }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: 'u1' }) });

    expect(res.status).toBe(200);
    expect(prismaMock.user.update).toHaveBeenCalled();
  });

  it('denies a non-admin FACULTY editing another user', async () => {
    authMock.mockResolvedValue({ user: { id: 'faculty', role: 'FACULTY' } });

    const req = new NextRequest('http://localhost/api/users/u1', {
      method: 'PATCH',
      body: JSON.stringify({ firstName: 'A' }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: 'u1' }) });

    expect(res.status).toBe(403);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('denies a non-admin TA editing another user', async () => {
    authMock.mockResolvedValue({ user: { id: 'ta', role: 'TA' } });

    const req = new NextRequest('http://localhost/api/users/u1', {
      method: 'PATCH',
      body: JSON.stringify({ firstName: 'A' }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: 'u1' }) });

    expect(res.status).toBe(403);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('allows user to update their own profile', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });
    prismaMock.user.findUnique.mockResolvedValue({ avatar: null });
    prismaMock.user.update.mockResolvedValue({
      id: 'u1',
      email: 'u1@example.com',
      firstName: 'Self',
      lastName: 'Update',
      role: 'STUDENT',
      inactive: false,
      avatar: null,
      timezone: null,
    });

    const req = new NextRequest('http://localhost/api/users/u1', {
      method: 'PATCH',
      body: JSON.stringify({ firstName: 'Self' }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: 'u1' }) });

    expect(res.status).toBe(200);
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

  it('accepts valid timezone', async () => {
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
      body: JSON.stringify({ timezone: 'America/New_York' }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: 'u1' }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.timezone).toBe('America/New_York');
  });

  it('returns 413 when avatar file exceeds size limit', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    getSystemUploadLimitMock.mockResolvedValue({ maxBytes: 100, maxMb: 0.0001 });

    const largeBuffer = Buffer.alloc(200);
    const formData = new FormData();
    formData.append('avatar', new Blob([largeBuffer], { type: 'image/png' }), 'large.png');

    const req = new NextRequest('http://localhost/api/users/u1', {
      method: 'PATCH',
      body: formData,
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: 'u1' }) });

    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.error).toContain('exceeds max upload size');
  });

  it('handles multipart form data with avatar upload', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    prismaMock.user.findUnique.mockResolvedValue({ avatar: null });
    prismaMock.user.update.mockResolvedValue({
      id: 'u1',
      email: 'u1@example.com',
      firstName: 'A',
      lastName: 'B',
      role: 'ADMIN',
      inactive: false,
      avatar: 'u1-123456-avatar.png',
      timezone: null,
    });

    const avatarBuffer = Buffer.from('fake-image-data');
    const formData = new FormData();
    formData.append('firstName', 'A');
    formData.append('avatar', new Blob([avatarBuffer], { type: 'image/png' }), 'avatar.png');

    const req = new NextRequest('http://localhost/api/users/u1', {
      method: 'PATCH',
      body: formData,
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: 'u1' }) });

    expect(res.status).toBe(200);
    expect(writeFileMock).toHaveBeenCalled();
  });

  it('deletes old avatar when uploading new one', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    prismaMock.user.findUnique.mockResolvedValue({ avatar: 'old-avatar.png' });
    prismaMock.user.update.mockResolvedValue({
      id: 'u1',
      email: 'u1@example.com',
      firstName: 'A',
      lastName: 'B',
      role: 'ADMIN',
      inactive: false,
      avatar: 'new-avatar.png',
      timezone: null,
    });

    const avatarBuffer = Buffer.from('new-image-data');
    const formData = new FormData();
    formData.append('avatar', new Blob([avatarBuffer], { type: 'image/png' }), 'new.png');

    const req = new NextRequest('http://localhost/api/users/u1', {
      method: 'PATCH',
      body: formData,
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: 'u1' }) });

    expect(res.status).toBe(200);
    expect(unlinkMock).toHaveBeenCalled();
    expect(writeFileMock).toHaveBeenCalled();
  });

  it('still uploads a new avatar when removing the old one fails', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    prismaMock.user.findUnique.mockResolvedValue({ avatar: 'old-avatar.png' });
    prismaMock.user.update.mockResolvedValue({
      id: 'u1',
      email: 'u1@example.com',
      firstName: 'A',
      lastName: 'B',
      role: 'ADMIN',
      inactive: false,
      avatar: 'new-avatar.png',
      timezone: null,
    });
    unlinkMock.mockRejectedValue(new Error('fs error'));

    const avatarBuffer = Buffer.from('new-image-data');
    const formData = new FormData();
    formData.append('avatar', new Blob([avatarBuffer], { type: 'image/png' }), 'new.png');

    const req = new NextRequest('http://localhost/api/users/u1', {
      method: 'PATCH',
      body: formData,
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: 'u1' }) });

    // The old-avatar unlink rejection is swallowed; the new file is still written.
    expect(res.status).toBe(200);
    expect(writeFileMock).toHaveBeenCalled();
  });

  it('handles deleteAvatar flag in form data', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    prismaMock.user.findUnique.mockResolvedValue({ avatar: 'avatar-to-delete.png' });
    prismaMock.user.update.mockResolvedValue({
      id: 'u1',
      email: 'u1@example.com',
      firstName: 'A',
      lastName: 'B',
      role: 'ADMIN',
      inactive: false,
      avatar: null,
      timezone: null,
    });

    const formData = new FormData();
    formData.append('deleteAvatar', 'true');
    formData.append('firstName', 'A');

    const req = new NextRequest('http://localhost/api/users/u1', {
      method: 'PATCH',
      body: formData,
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: 'u1' }) });

    expect(res.status).toBe(200);
    expect(unlinkMock).toHaveBeenCalled();
  });

  it('still succeeds when removing the old avatar file fails', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    prismaMock.user.findUnique.mockResolvedValue({ avatar: 'avatar-to-delete.png' });
    prismaMock.user.update.mockResolvedValue({
      id: 'u1',
      email: 'u1@example.com',
      firstName: 'A',
      lastName: 'B',
      role: 'ADMIN',
      inactive: false,
      avatar: null,
      timezone: null,
    });
    unlinkMock.mockRejectedValue(new Error('fs error'));

    const formData = new FormData();
    formData.append('deleteAvatar', 'true');
    formData.append('firstName', 'A');

    const req = new NextRequest('http://localhost/api/users/u1', {
      method: 'PATCH',
      body: formData,
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: 'u1' }) });

    // The unlink rejection is swallowed by the .catch() handler.
    expect(res.status).toBe(200);
  });

  it('updates role when parseRole returns valid role', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    parseRoleMock.mockReturnValue('FACULTY');
    prismaMock.user.findUnique.mockResolvedValue({ avatar: null });
    prismaMock.user.update.mockResolvedValue({
      id: 'u1',
      email: 'u1@example.com',
      firstName: 'A',
      lastName: 'B',
      role: 'FACULTY',
      inactive: false,
      avatar: null,
      timezone: null,
    });

    const req = new NextRequest('http://localhost/api/users/u1', {
      method: 'PATCH',
      body: JSON.stringify({ role: 'FACULTY' }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: 'u1' }) });

    expect(res.status).toBe(200);
    expect(parseRoleMock).toHaveBeenCalledWith('FACULTY');
  });

  it('returns 403 when setting user inactive while in active course', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    prismaMock.user.findUnique.mockResolvedValue({ avatar: null });
    prismaMock.roster.findMany.mockResolvedValue([
      { course: { isArchived: false, isPublished: true } },
    ]);

    const req = new NextRequest('http://localhost/api/users/u1', {
      method: 'PATCH',
      body: JSON.stringify({ inactive: true }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: 'u1' }) });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('Users in an active course cannot be inactive');
  });

  it('allows setting user inactive when not in active courses', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    prismaMock.user.findUnique.mockResolvedValue({ avatar: null });
    prismaMock.roster.findMany.mockResolvedValue([]);
    prismaMock.user.update.mockResolvedValue({
      id: 'u1',
      email: 'u1@example.com',
      firstName: 'A',
      lastName: 'B',
      role: 'ADMIN',
      inactive: true,
      avatar: null,
      timezone: null,
    });

    const req = new NextRequest('http://localhost/api/users/u1', {
      method: 'PATCH',
      body: JSON.stringify({ inactive: true }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: 'u1' }) });

    expect(res.status).toBe(200);
  });

  it('allows setting user inactive when in archived courses', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    prismaMock.user.findUnique.mockResolvedValue({ avatar: null });
    prismaMock.roster.findMany.mockResolvedValue([
      { course: { isArchived: true, isPublished: true } },
    ]);
    prismaMock.user.update.mockResolvedValue({
      id: 'u1',
      email: 'u1@example.com',
      firstName: 'A',
      lastName: 'B',
      role: 'ADMIN',
      inactive: true,
      avatar: null,
      timezone: null,
    });

    const req = new NextRequest('http://localhost/api/users/u1', {
      method: 'PATCH',
      body: JSON.stringify({ inactive: true }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: 'u1' }) });

    expect(res.status).toBe(200);
  });

  it('allows setting user inactive when in unpublished courses', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    prismaMock.user.findUnique.mockResolvedValue({ avatar: null });
    prismaMock.roster.findMany.mockResolvedValue([
      { course: { isArchived: false, isPublished: false } },
    ]);
    prismaMock.user.update.mockResolvedValue({
      id: 'u1',
      email: 'u1@example.com',
      firstName: 'A',
      lastName: 'B',
      role: 'ADMIN',
      inactive: true,
      avatar: null,
      timezone: null,
    });

    const req = new NextRequest('http://localhost/api/users/u1', {
      method: 'PATCH',
      body: JSON.stringify({ inactive: true }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: 'u1' }) });

    expect(res.status).toBe(200);
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

  it('returns 500 when database update fails', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    prismaMock.user.findUnique.mockResolvedValue({ avatar: null });
    prismaMock.user.update.mockRejectedValue(new Error('Database error'));

    const req = new NextRequest('http://localhost/api/users/u1', {
      method: 'PATCH',
      body: JSON.stringify({ firstName: 'A' }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: 'u1' }) });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('Failed to update user');
  });
});

describe('DELETE /api/users/[id]', () => {
  it('returns 403 when forbidden', async () => {
    authMock.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/users/u1', { method: 'DELETE' });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'u1' }) });

    expect(res.status).toBe(403);
  });

  it('returns 403 when user is STUDENT', async () => {
    authMock.mockResolvedValue({ user: { id: 'student', role: 'STUDENT' } });

    const req = new NextRequest('http://localhost/api/users/u1', { method: 'DELETE' });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'u1' }) });

    expect(res.status).toBe(403);
  });

  it('allows ADMIN to delete user', async () => {
    authMock.mockResolvedValue({ user: { id: 'admin', role: 'ADMIN', isAdmin: true } });
    prismaMock.user.findUnique.mockResolvedValue({ avatar: null });
    prismaMock.user.delete.mockResolvedValue({
      id: 'u1',
      email: 'u1@example.com',
      firstName: 'A',
      lastName: 'B',
      role: 'STUDENT',
      inactive: false,
      avatar: null,
      timezone: null,
      password: 'hashed',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const req = new NextRequest('http://localhost/api/users/u1', { method: 'DELETE' });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'u1' }) });

    expect(res.status).toBe(200);
    expect(prismaMock.user.delete).toHaveBeenCalledWith({ where: { id: 'u1' } });
  });

  it('denies a non-admin FACULTY deleting a user', async () => {
    authMock.mockResolvedValue({ user: { id: 'faculty', role: 'FACULTY' } });

    const req = new NextRequest('http://localhost/api/users/u1', { method: 'DELETE' });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'u1' }) });

    expect(res.status).toBe(403);
    expect(prismaMock.user.delete).not.toHaveBeenCalled();
  });

  it('denies a non-admin TA deleting a user', async () => {
    authMock.mockResolvedValue({ user: { id: 'ta', role: 'TA' } });

    const req = new NextRequest('http://localhost/api/users/u1', { method: 'DELETE' });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'u1' }) });

    expect(res.status).toBe(403);
    expect(prismaMock.user.delete).not.toHaveBeenCalled();
  });

  it('deletes avatar file when user has avatar', async () => {
    authMock.mockResolvedValue({ user: { id: 'admin', role: 'ADMIN', isAdmin: true } });
    prismaMock.user.findUnique.mockResolvedValue({ avatar: 'user-avatar.png' });
    prismaMock.user.delete.mockResolvedValue({
      id: 'u1',
      email: 'u1@example.com',
      firstName: 'A',
      lastName: 'B',
      role: 'STUDENT',
      inactive: false,
      avatar: 'user-avatar.png',
      timezone: null,
      password: 'hashed',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const req = new NextRequest('http://localhost/api/users/u1', { method: 'DELETE' });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'u1' }) });

    expect(res.status).toBe(200);
    expect(unlinkMock).toHaveBeenCalled();
  });

  it('still deletes the user when removing the avatar file fails', async () => {
    authMock.mockResolvedValue({ user: { id: 'admin', role: 'ADMIN', isAdmin: true } });
    prismaMock.user.findUnique.mockResolvedValue({ avatar: 'user-avatar.png' });
    prismaMock.user.delete.mockResolvedValue({
      id: 'u1',
      email: 'u1@example.com',
      firstName: 'A',
      lastName: 'B',
      role: 'STUDENT',
      inactive: false,
      avatar: 'user-avatar.png',
      timezone: null,
      password: 'hashed',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    unlinkMock.mockRejectedValue(new Error('fs error'));

    const req = new NextRequest('http://localhost/api/users/u1', { method: 'DELETE' });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'u1' }) });

    // The unlink rejection is swallowed by the .catch() handler.
    expect(res.status).toBe(200);
    expect(prismaMock.user.delete).toHaveBeenCalled();
  });

  it('skips avatar deletion when user has no avatar', async () => {
    authMock.mockResolvedValue({ user: { id: 'admin', role: 'ADMIN', isAdmin: true } });
    prismaMock.user.findUnique.mockResolvedValue({ avatar: null });
    prismaMock.user.delete.mockResolvedValue({
      id: 'u1',
      email: 'u1@example.com',
      firstName: 'A',
      lastName: 'B',
      role: 'STUDENT',
      inactive: false,
      avatar: null,
      timezone: null,
      password: 'hashed',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const req = new NextRequest('http://localhost/api/users/u1', { method: 'DELETE' });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'u1' }) });

    expect(res.status).toBe(200);
    expect(unlinkMock).not.toHaveBeenCalled();
  });

  it('preserves the deleted user\'s activity logs (audit trail)', async () => {
    authMock.mockResolvedValue({ user: { id: 'admin', role: 'ADMIN', isAdmin: true } });
    prismaMock.user.findUnique.mockResolvedValue({ avatar: null });
    prismaMock.user.delete.mockResolvedValue({
      id: 'u1',
      email: 'u1@example.com',
      firstName: 'A',
      lastName: 'B',
      role: 'STUDENT',
      inactive: false,
      avatar: null,
      timezone: null,
      password: 'hashed',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const req = new NextRequest('http://localhost/api/users/u1', { method: 'DELETE' });
    await DELETE(req, { params: Promise.resolve({ id: 'u1' }) });

    // The user's logs are intentionally NOT wiped — onDelete: SetNull keeps the
    // audit trail (userId nulled), so their history survives deletion.
    expect(prismaMock.activityLog.deleteMany).not.toHaveBeenCalled();
    expect(prismaMock.user.delete).toHaveBeenCalledWith({ where: { id: 'u1' } });
  });

  it('deletes user and logs activity', async () => {
    authMock.mockResolvedValue({ user: { id: 'admin', role: 'ADMIN', isAdmin: true } });
    prismaMock.user.findUnique.mockResolvedValue({ avatar: 'avatar.png' });
    prismaMock.user.delete.mockResolvedValue({
      id: 'u1',
      email: 'u1@example.com',
      firstName: 'A',
      lastName: 'B',
      role: 'STUDENT',
      inactive: false,
      avatar: 'avatar.png',
      timezone: null,
      password: 'hashed',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const req = new NextRequest('http://localhost/api/users/u1', { method: 'DELETE' });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'u1' }) });

    expect(res.status).toBe(200);
    expect(prismaMock.user.delete).toHaveBeenCalled();
    expect(activityLogMock).toHaveBeenCalled();
  });

  it('returns 500 when deletion fails', async () => {
    authMock.mockResolvedValue({ user: { id: 'admin', role: 'ADMIN', isAdmin: true } });
    prismaMock.user.findUnique.mockResolvedValue({ avatar: null });
    prismaMock.user.delete.mockRejectedValue(new Error('Database error'));

    const req = new NextRequest('http://localhost/api/users/u1', { method: 'DELETE' });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'u1' }) });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('Failed to delete user');
  });
});

describe('GET /api/users/[id]', () => {
  it('returns 405 for GET method', async () => {
    const res = await GET();

    expect(res.status).toBe(405);
    const body = await res.json();
    expect(body.error).toBe('Method not allowed');
  });
});

describe('POST /api/users/[id]', () => {
  it('returns 405 for POST method', async () => {
    const res = await POST();

    expect(res.status).toBe(405);
    const body = await res.json();
    expect(body.error).toBe('Method not allowed');
  });
});
