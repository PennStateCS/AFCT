import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
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
      readFile: vi.fn().mockResolvedValue(Buffer.from('solution content')),
    },
    default: {
      ...actual,
      existsSync,
      promises: {
        readFile: vi.fn().mockResolvedValue(Buffer.from('solution content')),
      },
    },
  };
});

import { GET } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.roster.findFirst.mockResolvedValue(null);
});

describe('GET /api/files/solutions/[file]', () => {
  it('returns 400 for invalid file param', async () => {
    const res = await GET(new NextRequest('http://localhost/api/files/solutions/..'), {
      params: Promise.resolve({ file: '../secret.txt' }),
    });

    expect(res.status).toBe(400);
  });

  it('returns 401 when not authenticated', async () => {
    authMock.mockResolvedValue(null);

    const res = await GET(new NextRequest('http://localhost/api/files/solutions/file.txt'), {
      params: Promise.resolve({ file: 'file.txt' }),
    });

    expect(res.status).toBe(401);
  });

  it('returns 404 when solution record not found', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1', role: 'FACULTY' } });
    prismaMock.problem.findFirst.mockResolvedValue(null);

    const res = await GET(new NextRequest('http://localhost/api/files/solutions/file.txt'), {
      params: Promise.resolve({ file: 'file.txt' }),
    });

    expect(res.status).toBe(404);
  });

  it('returns 403 when user is not faculty/ta/admin', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1', role: 'STUDENT' } });
    prismaMock.problem.findFirst.mockResolvedValue({
      id: 'problem-1',
      courseId: 'course-1',
      originalFileName: 'solution.txt',
    });

    const res = await GET(new NextRequest('http://localhost/api/files/solutions/file.txt'), {
      params: Promise.resolve({ file: 'file.txt' }),
    });

    expect(res.status).toBe(403);
    expect(activityLogMock).toHaveBeenCalledWith(
      prismaMock,
      expect.anything(),
      expect.objectContaining({
        action: 'SOLUTION_DOWNLOAD_DENIED',
        severity: 'SECURITY',
        category: 'PROBLEM',
        courseId: 'course-1',
      }),
    );
  });

  it('returns 404 when file does not exist on disk', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1', isAdmin: true } });
    prismaMock.problem.findFirst.mockResolvedValue({
      id: 'problem-1',
      courseId: 'course-1',
      fileName: 'file.txt',
      originalFileName: 'solution.txt',
    });
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const res = await GET(new NextRequest('http://localhost/api/files/solutions/file.txt'), {
      params: Promise.resolve({ file: 'file.txt' }),
    });

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe('File not found on disk');
  });

  it('serves solution file for admin user', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1', isAdmin: true } });
    prismaMock.problem.findFirst.mockResolvedValue({
      id: 'problem-1',
      courseId: 'course-1',
      fileName: 'file.txt',
      originalFileName: 'solution.txt',
    });
    vi.mocked(fs.existsSync).mockReturnValue(true);

    const res = await GET(new NextRequest('http://localhost/api/files/solutions/file.txt'), {
      params: Promise.resolve({ file: 'file.txt' }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/octet-stream');
    expect(res.headers.get('Content-Disposition')).toContain('solution.txt');
  });

  it('serves solution file for faculty user', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1' } });
    prismaMock.problem.findFirst.mockResolvedValue({
      id: 'problem-1',
      courseId: 'course-1',
      fileName: 'file.txt',
      originalFileName: 'solution.txt',
    });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });
    vi.mocked(fs.existsSync).mockReturnValue(true);

    const res = await GET(new NextRequest('http://localhost/api/files/solutions/file.txt'), {
      params: Promise.resolve({ file: 'file.txt' }),
    });

    expect(res.status).toBe(200);
  });

  it('serves solution file for TA user', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1' } });
    prismaMock.problem.findFirst.mockResolvedValue({
      id: 'problem-1',
      courseId: 'course-1',
      fileName: 'file.txt',
      originalFileName: 'solution.txt',
    });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'TA' });
    vi.mocked(fs.existsSync).mockReturnValue(true);

    const res = await GET(new NextRequest('http://localhost/api/files/solutions/file.txt'), {
      params: Promise.resolve({ file: 'file.txt' }),
    });

    expect(res.status).toBe(200);
  });

  it('logs download activity when download=1 param is present', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1', isAdmin: true } });
    prismaMock.problem.findFirst.mockResolvedValue({
      id: 'problem-1',
      courseId: 'course-1',
      fileName: 'file.txt',
      originalFileName: 'solution.txt',
    });
    vi.mocked(fs.existsSync).mockReturnValue(true);

    const req = new NextRequest('http://localhost/api/files/solutions/file.txt?download=1');
    const res = await GET(req, {
      params: Promise.resolve({ file: 'file.txt' }),
    });

    expect(res.status).toBe(200);
    expect(activityLogMock).toHaveBeenCalledWith(
      prismaMock,
      req,
      expect.objectContaining({
        userId: 'user-1',
        action: 'DOWNLOAD_SOLUTION_FILE',
        category: 'PROBLEM',
        courseId: 'course-1',
        problemId: 'problem-1',
      }),
    );
  });

  it('logs an inline serve when the download param is absent', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1', isAdmin: true } });
    prismaMock.problem.findFirst.mockResolvedValue({
      id: 'problem-1',
      courseId: 'course-1',
      fileName: 'file.txt',
      originalFileName: 'solution.txt',
    });
    vi.mocked(fs.existsSync).mockReturnValue(true);

    const res = await GET(new NextRequest('http://localhost/api/files/solutions/file.txt'), {
      params: Promise.resolve({ file: 'file.txt' }),
    });

    expect(res.status).toBe(200);
    // Every successful solution serve is now audited, including inline views.
    expect(activityLogMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        action: 'DOWNLOAD_SOLUTION_FILE',
        metadata: expect.objectContaining({ mode: 'inline' }),
      }),
    );
  });

  it('returns 500 and logs when reading the file throws', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1', isAdmin: true } });
    prismaMock.problem.findFirst.mockResolvedValue({
      id: 'problem-1',
      courseId: 'course-1',
      fileName: 'file.txt',
      originalFileName: 'solution.txt',
    });
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.promises.readFile).mockRejectedValueOnce(new Error('disk failure'));

    const res = await GET(new NextRequest('http://localhost/api/files/solutions/file.txt'), {
      params: Promise.resolve({ file: 'file.txt' }),
    });

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('Internal server error');
    expect(activityLogMock).toHaveBeenCalledWith(
      prismaMock,
      expect.anything(),
      expect.objectContaining({
        action: 'SOLUTION_DOWNLOAD_ERROR',
        severity: 'ERROR',
        category: 'PROBLEM',
      }),
    );
  });

  it('uses fileName when originalFileName is null', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1', isAdmin: true } });
    prismaMock.problem.findFirst.mockResolvedValue({
      id: 'problem-1',
      courseId: 'course-1',
      fileName: 'file.txt',
      originalFileName: null,
    });
    vi.mocked(fs.existsSync).mockReturnValue(true);

    const res = await GET(new NextRequest('http://localhost/api/files/solutions/file.txt'), {
      params: Promise.resolve({ file: 'file.txt' }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toContain('file.txt');
  });
});
