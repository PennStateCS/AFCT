import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  problem: { findFirst: vi.fn() },
  submission: { findFirst: vi.fn() },
  user: { findFirst: vi.fn() },
}));

const authMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());
const fsExistsSyncMock = vi.hoisted(() => vi.fn());
const fsUnlinkMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: fsExistsSyncMock,
    promises: {
      ...actual.promises,
      unlink: fsUnlinkMock,
    },
    default: {
      ...actual,
      existsSync: fsExistsSyncMock,
      promises: {
        ...actual.promises,
        unlink: fsUnlinkMock,
      },
    },
  };
});

import { DELETE } from './route';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('DELETE /api/status/abandoned-files', () => {
  it('returns 401 when not authenticated', async () => {
    authMock.mockResolvedValue(null);

    const req = new Request('http://localhost/api/status/abandoned-files', {
      method: 'DELETE',
      body: JSON.stringify({ category: 'solutions', fileName: 'file.txt' }),
    });

    const res = await DELETE(req);

    expect(res.status).toBe(401);
  });

  it('returns 403 and logs a denial for a signed-in non-admin', async () => {
    authMock.mockResolvedValue({ user: { id: 'f1', role: 'FACULTY' } });

    const req = new Request('http://localhost/api/status/abandoned-files', {
      method: 'DELETE',
      body: JSON.stringify({ category: 'solutions', fileName: 'file.txt' }),
    });

    const res = await DELETE(req);

    expect(res.status).toBe(403);
    expect(activityLogMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ action: 'ABANDONED_FILES_DELETE_DENIED', severity: 'SECURITY' }),
    );
  });

  it('returns 400 for invalid request', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });

    const req = new Request('http://localhost/api/status/abandoned-files', {
      method: 'DELETE',
      body: JSON.stringify({ category: 'solutions', fileName: '../bad.txt' }),
    });

    const res = await DELETE(req);

    expect(res.status).toBe(400);
  });

  it('returns 409 when file is still referenced', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });
    prismaMock.problem.findFirst.mockResolvedValue({ id: 'p1' });

    const req = new Request('http://localhost/api/status/abandoned-files', {
      method: 'DELETE',
      body: JSON.stringify({ category: 'solutions', fileName: 'file.txt' }),
    });

    const res = await DELETE(req);

    expect(res.status).toBe(409);
  });

  it('returns 404 when file not found on disk', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });
    prismaMock.problem.findFirst.mockResolvedValue(null);
    fsExistsSyncMock.mockReturnValue(false);

    const req = new Request('http://localhost/api/status/abandoned-files', {
      method: 'DELETE',
      body: JSON.stringify({ category: 'solutions', fileName: 'file.txt' }),
    });

    const res = await DELETE(req);

    expect(res.status).toBe(404);
  });

  it('deletes file when unreferenced and present', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });
    prismaMock.problem.findFirst.mockResolvedValue(null);
    fsExistsSyncMock.mockReturnValue(true);

    const req = new Request('http://localhost/api/status/abandoned-files', {
      method: 'DELETE',
      body: JSON.stringify({ category: 'solutions', fileName: 'file.txt' }),
    });

    const res = await DELETE(req);

    expect(res.status).toBe(200);
    expect(fsUnlinkMock).toHaveBeenCalled();
  });

  it('checks submissions category for references', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });
    prismaMock.submission.findFirst.mockResolvedValue({ id: 's1' });

    const req = new Request('http://localhost/api/status/abandoned-files', {
      method: 'DELETE',
      body: JSON.stringify({ category: 'submissions', fileName: 'submission.txt' }),
    });

    const res = await DELETE(req);

    expect(res.status).toBe(409);
    expect(prismaMock.submission.findFirst).toHaveBeenCalledWith({
      where: { fileName: 'submission.txt' },
    });
  });

  it('checks pfps category for references', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });
    prismaMock.user.findFirst.mockResolvedValue({ id: 'u1' });

    const req = new Request('http://localhost/api/status/abandoned-files', {
      method: 'DELETE',
      body: JSON.stringify({ category: 'pfps', fileName: 'avatar.jpg' }),
    });

    const res = await DELETE(req);

    expect(res.status).toBe(409);
    expect(prismaMock.user.findFirst).toHaveBeenCalledWith({
      where: { avatar: 'avatar.jpg' },
    });
  });

  it('deletes unreferenced submission file', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });
    prismaMock.submission.findFirst.mockResolvedValue(null);
    fsExistsSyncMock.mockReturnValue(true);

    const req = new Request('http://localhost/api/status/abandoned-files', {
      method: 'DELETE',
      body: JSON.stringify({ category: 'submissions', fileName: 'old.txt' }),
    });

    const res = await DELETE(req);

    expect(res.status).toBe(200);
    expect(fsUnlinkMock).toHaveBeenCalled();
  });

  it('deletes unreferenced pfp file', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });
    prismaMock.user.findFirst.mockResolvedValue(null);
    fsExistsSyncMock.mockReturnValue(true);

    const req = new Request('http://localhost/api/status/abandoned-files', {
      method: 'DELETE',
      body: JSON.stringify({ category: 'pfps', fileName: 'old-avatar.jpg' }),
    });

    const res = await DELETE(req);

    expect(res.status).toBe(200);
    expect(fsUnlinkMock).toHaveBeenCalled();
  });

  it('returns 500 on unexpected errors', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });
    prismaMock.problem.findFirst.mockRejectedValue(new Error('Database error'));

    const req = new Request('http://localhost/api/status/abandoned-files', {
      method: 'DELETE',
      body: JSON.stringify({ category: 'solutions', fileName: 'file.txt' }),
    });

    const res = await DELETE(req);

    expect(res.status).toBe(500);
  });

  it('returns 400 when the JSON body is unparseable (null body)', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });

    const req = new Request('http://localhost/api/status/abandoned-files', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });

    const res = await DELETE(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Invalid request');
  });

  it('returns 400 for an unknown category', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });

    const req = new Request('http://localhost/api/status/abandoned-files', {
      method: 'DELETE',
      body: JSON.stringify({ category: 'bogus', fileName: 'file.txt' }),
    });

    const res = await DELETE(req);

    expect(res.status).toBe(400);
  });

  it('rejects an empty file name (isSafeFileName guard)', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });

    const req = new Request('http://localhost/api/status/abandoned-files', {
      method: 'DELETE',
      body: JSON.stringify({ category: 'solutions', fileName: '   ' }),
    });

    const res = await DELETE(req);

    expect(res.status).toBe(400);
  });

  it('rejects a file name containing a backslash separator', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });

    const req = new Request('http://localhost/api/status/abandoned-files', {
      method: 'DELETE',
      body: JSON.stringify({ category: 'solutions', fileName: 'sub\\file.txt' }),
    });

    const res = await DELETE(req);

    expect(res.status).toBe(400);
  });

  it('rejects a file name containing a forward-slash separator', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });

    const req = new Request('http://localhost/api/status/abandoned-files', {
      method: 'DELETE',
      body: JSON.stringify({ category: 'solutions', fileName: 'sub/file.txt' }),
    });

    const res = await DELETE(req);

    expect(res.status).toBe(400);
  });

  it('returns 500 with "unknown error" when a non-Error value is thrown', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });
    prismaMock.problem.findFirst.mockRejectedValue('a plain string');

    const req = new Request('http://localhost/api/status/abandoned-files', {
      method: 'DELETE',
      body: JSON.stringify({ category: 'solutions', fileName: 'file.txt' }),
    });

    const res = await DELETE(req);

    expect(res.status).toBe(500);
    expect(activityLogMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        action: 'ABANDONED_FILES_DELETE_ERROR',
        metadata: expect.objectContaining({ error: 'unknown error' }),
      }),
    );
  });
});
