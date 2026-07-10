import { beforeEach, describe, expect, it, vi } from 'vitest';

const authMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());
const prismaMock = vi.hoisted(() => ({
  problem: { findMany: vi.fn(), findFirst: vi.fn() },
  submission: { findMany: vi.fn(), findFirst: vi.fn() },
  user: { findMany: vi.fn(), findFirst: vi.fn() },
}));

vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  const readdir = vi.fn().mockResolvedValue([]);
  const existsSync = vi.fn().mockReturnValue(true);
  const unlink = vi.fn().mockResolvedValue(undefined);
  return {
    ...actual,
    existsSync,
    promises: { ...actual.promises, readdir, unlink },
    default: { ...actual, existsSync, promises: { ...actual.promises, readdir, unlink } },
  };
});

import { GET, DELETE } from './route';
import fs from 'fs';
import { routeCtx } from '@/test/route';

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } });
  prismaMock.problem.findMany.mockResolvedValue([]);
  prismaMock.submission.findMany.mockResolvedValue([]);
  prismaMock.user.findMany.mockResolvedValue([]);
  prismaMock.problem.findFirst.mockResolvedValue(null);
  prismaMock.submission.findFirst.mockResolvedValue(null);
  prismaMock.user.findFirst.mockResolvedValue(null);
});

const getReq = () => new Request('http://localhost/api/admin/status/files');
const delReq = (body: unknown) =>
  new Request('http://localhost/api/admin/status/files', {
    method: 'DELETE',
    body: JSON.stringify(body),
  });

describe('GET /api/admin/status/files', () => {
  it('401 / 403 gates', async () => {
    authMock.mockResolvedValue(null);
    expect((await GET(getReq(), routeCtx())).status).toBe(401);
    authMock.mockResolvedValue({ user: { id: 'u1', isAdmin: false } });
    expect((await GET(getReq(), routeCtx())).status).toBe(403);
  });

  it('classifies orphaned uploads by category and caps samples at 50', async () => {
    vi.mocked(fs.promises.readdir).mockImplementation(async (dir: unknown) => {
      const d = String(dir);
      const ent = (name: string) => ({ isFile: () => true, name });
      if (d.includes('solutions'))
        return Array.from({ length: 60 }, (_, i) => ent(`orphan-${i}.jff`)) as never;
      if (d.includes('submissions')) return [ent('sub1.txt'), ent('orphan-sub.txt')] as never;
      return [] as never;
    });
    prismaMock.submission.findMany.mockResolvedValue([{ fileName: 'sub1.txt' }]);

    const res = await GET(getReq(), routeCtx());
    expect(res.status).toBe(200);
    const { abandonedFiles } = await res.json();
    expect(abandonedFiles.byCategory.solutions).toBe(60);
    expect(abandonedFiles.byCategory.submissions).toBe(1);
    expect(abandonedFiles.samples.length).toBe(50);
  });
});

describe('DELETE /api/admin/status/files', () => {
  it('400 for an unknown category or unsafe name', async () => {
    expect((await DELETE(delReq({ category: 'bogus', fileName: 'x' }), routeCtx())).status).toBe(400);
    expect((await DELETE(delReq({ category: 'pfps', fileName: '../escape' }), routeCtx())).status).toBe(
      400,
    );
  });

  it('409 when a DB row still references the file', async () => {
    prismaMock.submission.findFirst.mockResolvedValue({ id: 's1' });
    expect((await DELETE(delReq({ category: 'submissions', fileName: 'f.txt' }), routeCtx())).status).toBe(
      409,
    );
  });

  it('404 when the file is not on disk', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    expect((await DELETE(delReq({ category: 'pfps', fileName: 'a.png' }), routeCtx())).status).toBe(404);
  });

  it('deletes an unreferenced file and audits it', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    const res = await DELETE(delReq({ category: 'pfps', fileName: 'a.png' }), routeCtx());
    expect(res.status).toBe(200);
    expect(fs.promises.unlink).toHaveBeenCalled();
    expect(activityLogMock).toHaveBeenCalledWith(
      prismaMock,
      expect.anything(),
      expect.objectContaining({ action: 'ABANDONED_FILE_DELETED' }),
    );
  });
});
