import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const prismaMock = vi.hoisted(() => ({
  problem: {
    findFirst: vi.fn(),
  },
  roster: {
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

describe('GET /api/solutions/[file]', () => {
  it('returns 400 for invalid file param', async () => {
    const res = await GET(new NextRequest('http://localhost/api/solutions/..'), {
      params: Promise.resolve({ file: '../secret.txt' }),
    });

    expect(res.status).toBe(400);
  });

  it('returns 401 when not authenticated', async () => {
    authMock.mockResolvedValue(null);

    const res = await GET(new NextRequest('http://localhost/api/solutions/file.txt'), {
      params: Promise.resolve({ file: 'file.txt' }),
    });

    expect(res.status).toBe(401);
  });

  it('returns 404 when solution record not found', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1', role: 'FACULTY' } });
    prismaMock.problem.findFirst.mockResolvedValue(null);

    const res = await GET(new NextRequest('http://localhost/api/solutions/file.txt'), {
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

    const res = await GET(new NextRequest('http://localhost/api/solutions/file.txt'), {
      params: Promise.resolve({ file: 'file.txt' }),
    });

    expect(res.status).toBe(403);
  });
});
