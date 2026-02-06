import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  problem: { findFirst: vi.fn() },
  submission: { findFirst: vi.fn() },
  user: { findFirst: vi.fn() },
}));

const authMock = vi.hoisted(() => vi.fn());
const fsExistsSyncMock = vi.hoisted(() => vi.fn());
const fsUnlinkMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));
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

  it('returns 400 for invalid request', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });

    const req = new Request('http://localhost/api/status/abandoned-files', {
      method: 'DELETE',
      body: JSON.stringify({ category: 'solutions', fileName: '../bad.txt' }),
    });

    const res = await DELETE(req);

    expect(res.status).toBe(400);
  });

  it('returns 409 when file is still referenced', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    prismaMock.problem.findFirst.mockResolvedValue({ id: 'p1' });

    const req = new Request('http://localhost/api/status/abandoned-files', {
      method: 'DELETE',
      body: JSON.stringify({ category: 'solutions', fileName: 'file.txt' }),
    });

    const res = await DELETE(req);

    expect(res.status).toBe(409);
  });

  it('returns 404 when file not found on disk', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
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
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
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
});
