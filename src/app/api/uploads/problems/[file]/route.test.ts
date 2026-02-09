import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';

const prismaMock = vi.hoisted(() => ({
  problem: {
    findFirst: vi.fn(),
  },
  roster: {
    findFirst: vi.fn(),
  },
}));

const authMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  const existsSync = vi.fn().mockReturnValue(true);
  return {
    ...actual,
    existsSync,
    promises: {
      readFile: vi.fn().mockResolvedValue(Buffer.from('problem content')),
    },
    default: {
      ...actual,
      existsSync,
      promises: {
        readFile: vi.fn().mockResolvedValue(Buffer.from('problem content')),
      },
    },
  };
});

import { GET } from './route';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/uploads/problems/[file]', () => {
  it('returns 400 for invalid file param', async () => {
    const res = await GET(new Request('http://localhost/api/uploads/problems/..'), {
      params: Promise.resolve({ file: '../secret.txt' }),
    });

    expect(res.status).toBe(400);
  });

  it('returns 401 when not authenticated', async () => {
    authMock.mockResolvedValue(null);

    const res = await GET(new Request('http://localhost/api/uploads/problems/file.txt'), {
      params: Promise.resolve({ file: 'file.txt' }),
    });

    expect(res.status).toBe(401);
  });

  it('returns 404 when problem not found', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1', role: 'STUDENT' } });
    prismaMock.problem.findFirst.mockResolvedValue(null);

    const res = await GET(new Request('http://localhost/api/uploads/problems/file.txt'), {
      params: Promise.resolve({ file: 'file.txt' }),
    });

    expect(res.status).toBe(404);
  });

  it('returns 403 when user is not allowed', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1', role: 'STUDENT' } });
    prismaMock.problem.findFirst.mockResolvedValue({
      id: 'problem-1',
      courseId: 'course-1',
      originalFileName: 'problem.txt',
    });
    prismaMock.roster.findFirst.mockResolvedValue(null);

    const res = await GET(new Request('http://localhost/api/uploads/problems/file.txt'), {
      params: Promise.resolve({ file: 'file.txt' }),
    });

    expect(res.status).toBe(403);
  });

  it('allows admin to download file', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1', role: 'ADMIN' } });
    prismaMock.problem.findFirst.mockResolvedValue({
      id: 'problem-1',
      courseId: 'course-1',
      fileName: 'file.txt',
      originalFileName: 'original.txt',
    });
    vi.mocked(fs.existsSync).mockReturnValue(true);

    const res = await GET(new Request('http://localhost/api/uploads/problems/file.txt'), {
      params: Promise.resolve({ file: 'file.txt' }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toContain('original.txt');
    expect(activityLogMock).toHaveBeenCalled();
  });

  it('allows faculty to download file', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1', role: 'FACULTY' } });
    prismaMock.problem.findFirst.mockResolvedValue({
      id: 'problem-1',
      courseId: 'course-1',
      fileName: 'file.txt',
      originalFileName: 'original.txt',
    });
    vi.mocked(fs.existsSync).mockReturnValue(true);

    const res = await GET(new Request('http://localhost/api/uploads/problems/file.txt'), {
      params: Promise.resolve({ file: 'file.txt' }),
    });

    expect(res.status).toBe(200);
  });

  it('allows TA to download file', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1', role: 'TA' } });
    prismaMock.problem.findFirst.mockResolvedValue({
      id: 'problem-1',
      courseId: 'course-1',
      fileName: 'file.txt',
      originalFileName: 'original.txt',
    });
    vi.mocked(fs.existsSync).mockReturnValue(true);

    const res = await GET(new Request('http://localhost/api/uploads/problems/file.txt'), {
      params: Promise.resolve({ file: 'file.txt' }),
    });

    expect(res.status).toBe(200);
  });

  it('allows enrolled student to download file', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1', role: 'STUDENT' } });
    prismaMock.problem.findFirst.mockResolvedValue({
      id: 'problem-1',
      courseId: 'course-1',
      fileName: 'file.txt',
      originalFileName: 'original.txt',
    });
    prismaMock.roster.findFirst.mockResolvedValue({ id: 'roster-1' });
    vi.mocked(fs.existsSync).mockReturnValue(true);

    const res = await GET(new Request('http://localhost/api/uploads/problems/file.txt'), {
      params: Promise.resolve({ file: 'file.txt' }),
    });

    expect(res.status).toBe(200);
  });

  it('returns 404 when file not on disk', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1', role: 'ADMIN' } });
    prismaMock.problem.findFirst.mockResolvedValue({
      id: 'problem-1',
      courseId: 'course-1',
      fileName: 'file.txt',
      originalFileName: 'original.txt',
    });
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const res = await GET(new Request('http://localhost/api/uploads/problems/file.txt'), {
      params: Promise.resolve({ file: 'file.txt' }),
    });

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe('File not found on disk');
  });

  it('uses fileName when originalFileName is null', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1', role: 'ADMIN' } });
    prismaMock.problem.findFirst.mockResolvedValue({
      id: 'problem-1',
      courseId: 'course-1',
      fileName: 'file.txt',
      originalFileName: null,
    });
    vi.mocked(fs.existsSync).mockReturnValue(true);

    const res = await GET(new Request('http://localhost/api/uploads/problems/file.txt'), {
      params: Promise.resolve({ file: 'file.txt' }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toContain('file.txt');
  });
});
