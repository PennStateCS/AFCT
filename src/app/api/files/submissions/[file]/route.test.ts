import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';

const prismaMock = vi.hoisted(() => ({
  submission: {
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
      readFile: vi.fn().mockResolvedValue(Buffer.from('submission content')),
    },
    default: {
      ...actual,
      existsSync,
      promises: {
        readFile: vi.fn().mockResolvedValue(Buffer.from('submission content')),
      },
    },
  };
});

import { GET } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.roster.findFirst.mockResolvedValue(null);
});

describe('GET /api/files/submissions/[file]', () => {
  it('returns 400 for invalid file param', async () => {
    const res = await GET(new Request('http://localhost/api/files/submissions/..'), {
      params: Promise.resolve({ file: '../secret.txt' }),
    });

    expect(res.status).toBe(400);
  });

  it('returns 401 when not authenticated', async () => {
    authMock.mockResolvedValue(null);

    const res = await GET(new Request('http://localhost/api/files/submissions/file.txt'), {
      params: Promise.resolve({ file: 'file.txt' }),
    });

    expect(res.status).toBe(401);
  });

  it('returns 404 when submission not found', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1', role: 'STUDENT' } });
    prismaMock.submission.findFirst.mockResolvedValue(null);

    const res = await GET(new Request('http://localhost/api/files/submissions/file.txt'), {
      params: Promise.resolve({ file: 'file.txt' }),
    });

    expect(res.status).toBe(404);
  });

  it('returns 403 when user is not allowed', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1' } });
    prismaMock.submission.findFirst.mockResolvedValue({
      originalFileName: 'solution.txt',
      studentId: 'user-2',
      assignmentId: 'assignment-1',
      courseId: 'course-1',
    });

    const res = await GET(new Request('http://localhost/api/files/submissions/file.txt'), {
      params: Promise.resolve({ file: 'file.txt' }),
    });

    expect(res.status).toBe(403);
  });

  it('allows admin to download submission', async () => {
    authMock.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } });
    prismaMock.submission.findFirst.mockResolvedValue({
      id: 'sub-1',
      originalFileName: 'solution.txt',
      studentId: 'user-2',
      assignmentId: 'assignment-1',
      courseId: 'course-1',
    });
    vi.mocked(fs.existsSync).mockReturnValue(true);

    const res = await GET(new Request('http://localhost/api/files/submissions/file.txt'), {
      params: Promise.resolve({ file: 'file.txt' }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toContain('solution.txt');
    expect(activityLogMock).toHaveBeenCalled();
  });

  it('allows faculty to download submission', async () => {
    authMock.mockResolvedValue({ user: { id: 'fac-1' } });
    prismaMock.submission.findFirst.mockResolvedValue({
      id: 'sub-1',
      originalFileName: 'solution.txt',
      studentId: 'user-2',
      assignmentId: 'assignment-1',
      courseId: 'course-1',
    });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });
    vi.mocked(fs.existsSync).mockReturnValue(true);

    const res = await GET(new Request('http://localhost/api/files/submissions/file.txt'), {
      params: Promise.resolve({ file: 'file.txt' }),
    });

    expect(res.status).toBe(200);
  });

  it('allows TA to download submission', async () => {
    authMock.mockResolvedValue({ user: { id: 'ta-1' } });
    prismaMock.submission.findFirst.mockResolvedValue({
      id: 'sub-1',
      originalFileName: 'solution.txt',
      studentId: 'user-2',
      assignmentId: 'assignment-1',
      courseId: 'course-1',
    });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'TA' });
    vi.mocked(fs.existsSync).mockReturnValue(true);

    const res = await GET(new Request('http://localhost/api/files/submissions/file.txt'), {
      params: Promise.resolve({ file: 'file.txt' }),
    });

    expect(res.status).toBe(200);
  });

  it('allows student to download own submission', async () => {
    authMock.mockResolvedValue({ user: { id: 'student-1', role: 'STUDENT' } });
    prismaMock.submission.findFirst.mockResolvedValue({
      id: 'sub-1',
      originalFileName: 'solution.txt',
      studentId: 'student-1',
      assignmentId: 'assignment-1',
    });
    vi.mocked(fs.existsSync).mockReturnValue(true);

    const res = await GET(new Request('http://localhost/api/files/submissions/file.txt'), {
      params: Promise.resolve({ file: 'file.txt' }),
    });

    expect(res.status).toBe(200);
  });

  it('returns 404 when file not on disk', async () => {
    authMock.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } });
    prismaMock.submission.findFirst.mockResolvedValue({
      id: 'sub-1',
      originalFileName: 'solution.txt',
      studentId: 'user-2',
      assignmentId: 'assignment-1',
      courseId: 'course-1',
    });
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const res = await GET(new Request('http://localhost/api/files/submissions/file.txt'), {
      params: Promise.resolve({ file: 'file.txt' }),
    });

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe('File not found on disk');
  });

  it('returns 500 and logs when reading the file throws', async () => {
    authMock.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } });
    prismaMock.submission.findFirst.mockResolvedValue({
      id: 'sub-1',
      originalFileName: 'solution.txt',
      studentId: 'user-2',
      assignmentId: 'assignment-1',
      courseId: 'course-1',
    });
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.promises.readFile).mockRejectedValueOnce(new Error('disk failure'));

    const res = await GET(new Request('http://localhost/api/files/submissions/file.txt'), {
      params: Promise.resolve({ file: 'file.txt' }),
    });

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('Internal server error');
    expect(activityLogMock).toHaveBeenCalledWith(
      prismaMock,
      expect.anything(),
      expect.objectContaining({ action: 'SUBMISSION_FILE_DOWNLOAD_ERROR', severity: 'ERROR' }),
    );
  });

  it('uses fileName when originalFileName is null', async () => {
    authMock.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } });
    prismaMock.submission.findFirst.mockResolvedValue({
      id: 'sub-1',
      originalFileName: null,
      studentId: 'user-2',
      assignmentId: 'assignment-1',
      courseId: 'course-1',
    });
    vi.mocked(fs.existsSync).mockReturnValue(true);

    const res = await GET(new Request('http://localhost/api/files/submissions/file.txt'), {
      params: Promise.resolve({ file: 'file.txt' }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toContain('file.txt');
  });
});
