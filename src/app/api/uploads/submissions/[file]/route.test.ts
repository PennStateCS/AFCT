import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  submission: {
    findFirst: vi.fn(),
  },
}));

const authMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));

import { GET } from './route';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/uploads/submissions/[file]', () => {
  it('returns 400 for invalid file param', async () => {
    const res = await GET(new Request('http://localhost/api/uploads/submissions/..'), {
      params: Promise.resolve({ file: '../secret.txt' }),
    });

    expect(res.status).toBe(400);
  });

  it('returns 401 when not authenticated', async () => {
    authMock.mockResolvedValue(null);

    const res = await GET(new Request('http://localhost/api/uploads/submissions/file.txt'), {
      params: Promise.resolve({ file: 'file.txt' }),
    });

    expect(res.status).toBe(401);
  });

  it('returns 404 when submission not found', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1', role: 'STUDENT' } });
    prismaMock.submission.findFirst.mockResolvedValue(null);

    const res = await GET(new Request('http://localhost/api/uploads/submissions/file.txt'), {
      params: Promise.resolve({ file: 'file.txt' }),
    });

    expect(res.status).toBe(404);
  });

  it('returns 403 when user is not allowed', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1', role: 'STUDENT' } });
    prismaMock.submission.findFirst.mockResolvedValue({
      originalFileName: 'solution.txt',
      studentId: 'user-2',
      assignmentId: 'assignment-1',
    });

    const res = await GET(new Request('http://localhost/api/uploads/submissions/file.txt'), {
      params: Promise.resolve({ file: 'file.txt' }),
    });

    expect(res.status).toBe(403);
  });
});
