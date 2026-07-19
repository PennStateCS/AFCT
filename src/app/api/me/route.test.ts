import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
}));

const authMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());
const uploadLimitMock = vi.hoisted(() => vi.fn());
const existsSyncMock = vi.hoisted(() => vi.fn());
const mkdirMock = vi.hoisted(() => vi.fn());
const writeFileMock = vi.hoisted(() => vi.fn());
const unlinkMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));
vi.mock('@/lib/upload-limits', () => ({ getSystemUploadLimit: uploadLimitMock }));
vi.mock('fs', () => ({ existsSync: existsSyncMock }));
vi.mock('fs/promises', () => ({ mkdir: mkdirMock, writeFile: writeFileMock, unlink: unlinkMock }));

import { GET, POST } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  uploadLimitMock.mockResolvedValue({ maxBytes: 5 * 1024 * 1024, maxMb: 5 });
  existsSyncMock.mockReset();
  mkdirMock.mockReset();
  writeFileMock.mockReset();
  unlinkMock.mockReset();
  existsSyncMock.mockReturnValue(true);
});

// A valid PNG magic-byte header, so uploads pass the signature check in avatar-upload.
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const makeFile = (size = 1024, name = 'avatar.png') => {
  const bytes = new Uint8Array(Math.max(size, PNG_SIGNATURE.length));
  bytes.set(PNG_SIGNATURE);
  return Object.assign(new File([bytes], name, { type: 'image/png' }), {
    arrayBuffer: async () => bytes.buffer,
  });
};

describe('GET /api/me', () => {
  it('returns 401 when not authenticated', async () => {
    authMock.mockResolvedValue(null);

    const res = await GET();

    expect(res.status).toBe(401);
  });

  it('returns user profile when authenticated', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1' } });
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      firstName: 'Test',
      lastName: 'User',
      avatar: null,
      role: 'STUDENT',
      timezone: 'UTC',
    });

    const res = await GET();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      id: 'user-1',
      email: 'user@example.com',
      firstName: 'Test',
      lastName: 'User',
      role: 'STUDENT',
      timezone: 'UTC',
    });
  });
});

describe('POST /api/me', () => {
  it('returns 401 when not authenticated', async () => {
    authMock.mockResolvedValue(null);

    const formData = new FormData();
    formData.set('firstName', 'A');
    formData.set('lastName', 'B');

    const req = new Request('http://localhost/api/me', {
      method: 'POST',
      body: formData,
    });

    const res = await POST(req);

    expect(res.status).toBe(401);
  });

  it('returns 400 when name fields missing', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1' } });

    const formData = new FormData();
    formData.set('firstName', '');
    formData.set('lastName', '');

    const req = new Request('http://localhost/api/me', {
      method: 'POST',
      body: formData,
    });

    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  it('returns 400 when timezone invalid', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1' } });

    const formData = new FormData();
    formData.set('firstName', 'A');
    formData.set('lastName', 'B');
    formData.set('timezone', 'Invalid/Zone');

    const req = new Request('http://localhost/api/me', {
      method: 'POST',
      body: formData,
    });

    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  it('updates user profile and logs activity', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1' } });
    prismaMock.user.findUnique.mockResolvedValue({ id: 'user-1', avatar: null });
    prismaMock.user.update.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      firstName: 'A',
      lastName: 'B',
      avatar: null,
      role: 'STUDENT',
      timezone: 'UTC',
    });

    const formData = new FormData();
    formData.set('firstName', 'A');
    formData.set('lastName', 'B');
    formData.set('timezone', 'UTC');

    const req = new Request('http://localhost/api/me', {
      method: 'POST',
      body: formData,
    });

    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(prismaMock.user.update).toHaveBeenCalled();
    expect(activityLogMock).toHaveBeenCalled();
  });

  it('returns 404 when current user not found', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1' } });
    prismaMock.user.findUnique.mockResolvedValue(null);

    const formData = new FormData();
    formData.set('firstName', 'A');
    formData.set('lastName', 'B');

    const req = new Request('http://localhost/api/me', {
      method: 'POST',
      body: formData,
    });

    const res = await POST(req);

    expect(res.status).toBe(404);
  });

  it('returns 413 when avatar exceeds size limit', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1' } });
    prismaMock.user.findUnique.mockResolvedValue({ id: 'user-1', avatar: null });

    const largeFile = makeFile(6 * 1024 * 1024, 'big.png');
    const formData = new FormData();
    formData.set('firstName', 'A');
    formData.set('lastName', 'B');
    formData.set('avatar', largeFile);

    const req = new Request('http://localhost/api/me', {
      method: 'POST',
      body: formData,
    });

    const res = await POST(req);

    expect(res.status).toBe(413);
    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it('uploads a new avatar and removes the previous one', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1' } });
    prismaMock.user.findUnique.mockResolvedValue({ id: 'user-1', avatar: 'old.png' });
    prismaMock.user.update.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      firstName: 'A',
      lastName: 'B',
      avatar: 'new.png',
      role: 'STUDENT',
      timezone: null,
    });
    existsSyncMock.mockReturnValue(true);

    const file = makeFile(1024, 'avatar.png');
    const formData = new FormData();
    formData.set('firstName', 'A');
    formData.set('lastName', 'B');
    formData.set('avatar', file);

    const req = new Request('http://localhost/api/me', {
      method: 'POST',
      body: formData,
    });

    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(writeFileMock).toHaveBeenCalled();
    expect(unlinkMock).toHaveBeenCalledWith(expect.stringContaining('old.png'));
  });

  it('stores an extensionless avatar under a safe userId-prefixed UUID name', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1' } });
    prismaMock.user.findUnique.mockResolvedValue({ id: 'user-1', avatar: null });
    prismaMock.user.update.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      firstName: 'A',
      lastName: 'B',
      avatar: 'new',
      timezone: null,
    });
    existsSyncMock.mockReturnValue(true);

    const file = makeFile(1024, 'avatar-no-ext');
    const formData = new FormData();
    formData.set('firstName', 'A');
    formData.set('lastName', 'B');
    formData.set('avatar', file);

    const req = new Request('http://localhost/api/me', {
      method: 'POST',
      body: formData,
    });

    const res = await POST(req);

    expect(res.status).toBe(200);
    // No extension is derived from an unsafe/extensionless name; the stored file is
    // a random UUID prefixed with the userId (and never client-derived).
    expect(writeFileMock).toHaveBeenCalledWith(
      expect.stringMatching(/[/\\]user-1_[0-9a-f-]+$/),
      expect.anything(),
    );
  });

  it('rejects a non-image avatar upload', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1' } });
    prismaMock.user.findUnique.mockResolvedValue({ id: 'user-1', avatar: null });

    const file = Object.assign(new File([new Uint8Array(1024)], 'evil.svg', { type: 'text/html' }), {
      arrayBuffer: async () => new Uint8Array(1024).buffer,
    });
    const formData = new FormData();
    formData.set('firstName', 'A');
    formData.set('lastName', 'B');
    formData.set('avatar', file);

    const req = new Request('http://localhost/api/me', { method: 'POST', body: formData });
    const res = await POST(req);

    expect(res.status).toBe(400);
    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it('deletes the current avatar when deleteAvatar is true', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1' } });
    prismaMock.user.findUnique.mockResolvedValue({ id: 'user-1', avatar: 'old.png' });
    prismaMock.user.update.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      firstName: 'A',
      lastName: 'B',
      avatar: null,
      role: 'STUDENT',
      timezone: null,
    });

    const formData = new FormData();
    formData.set('firstName', 'A');
    formData.set('lastName', 'B');
    formData.set('deleteAvatar', 'true');

    const req = new Request('http://localhost/api/me', {
      method: 'POST',
      body: formData,
    });

    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(unlinkMock).toHaveBeenCalledWith(expect.stringContaining('old.png'));
    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ avatar: null }),
      }),
    );
  });

  it('returns 500 and logs when the update throws', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1' } });
    prismaMock.user.findUnique.mockResolvedValue({ id: 'user-1', avatar: null });
    prismaMock.user.update.mockRejectedValueOnce(new Error('db down'));

    const formData = new FormData();
    formData.set('firstName', 'A');
    formData.set('lastName', 'B');

    const req = new Request('http://localhost/api/me', {
      method: 'POST',
      body: formData,
    });

    const res = await POST(req);

    expect(res.status).toBe(500);
    expect(activityLogMock).toHaveBeenCalledWith(
      prismaMock,
      req,
      expect.objectContaining({ action: 'PROFILE_UPDATE_ERROR', severity: 'ERROR' }),
    );
  });

  it('returns 500 with a generic message when the thrown value is not an Error', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1' } });
    prismaMock.user.findUnique.mockResolvedValue({ id: 'user-1', avatar: null });
    prismaMock.user.update.mockRejectedValueOnce('boom');

    const formData = new FormData();
    formData.set('firstName', 'A');
    formData.set('lastName', 'B');

    const req = new Request('http://localhost/api/me', {
      method: 'POST',
      body: formData,
    });

    const res = await POST(req);

    expect(res.status).toBe(500);
    expect(activityLogMock).toHaveBeenCalledWith(
      prismaMock,
      req,
      expect.objectContaining({
        action: 'PROFILE_UPDATE_ERROR',
        metadata: expect.objectContaining({ error: 'unknown error' }),
      }),
    );
  });

  it('swallows unlink errors when deleting a previous avatar', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1' } });
    prismaMock.user.findUnique.mockResolvedValue({ id: 'user-1', avatar: 'old.png' });
    prismaMock.user.update.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      firstName: 'A',
      lastName: 'B',
      avatar: null,
      timezone: null,
    });
    existsSyncMock.mockReturnValue(true);
    unlinkMock.mockRejectedValueOnce(new Error('permission denied'));

    const formData = new FormData();
    formData.set('firstName', 'A');
    formData.set('lastName', 'B');
    formData.set('deleteAvatar', 'true');

    const req = new Request('http://localhost/api/me', {
      method: 'POST',
      body: formData,
    });

    const res = await POST(req);

    // The unlink failure is caught inside deleteFileIfExists; the update still succeeds.
    expect(res.status).toBe(200);
    expect(unlinkMock).toHaveBeenCalled();
  });

  it('creates the upload directory when missing', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1' } });
    prismaMock.user.findUnique.mockResolvedValue({ id: 'user-1', avatar: null });
    existsSyncMock.mockReturnValueOnce(false).mockReturnValue(true);

    const formData = new FormData();
    formData.set('firstName', 'A');
    formData.set('lastName', 'B');

    const req = new Request('http://localhost/api/me', {
      method: 'POST',
      body: formData,
    });

    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(mkdirMock).toHaveBeenCalled();
  });
});
