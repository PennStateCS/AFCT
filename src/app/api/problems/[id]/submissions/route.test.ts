import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const prismaMock = vi.hoisted(() => ({
  submission: {
    findMany: vi.fn(),
  },
}));

const authMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));

import { GET } from './route';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/problems/[id]/submissions', () => {
  it('returns 401 when not authenticated', async () => {
    authMock.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/problems/problem-1/submissions');
    const res = await GET(req, { params: Promise.resolve({ id: 'problem-1' }) });

    expect(res.status).toBe(401);
  });

  it('returns 403 when requesting another user without permission', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1', role: 'STUDENT' } });

    const req = new NextRequest(
      'http://localhost/api/problems/problem-1/submissions?userId=user-2',
    );
    const res = await GET(req, { params: Promise.resolve({ id: 'problem-1' }) });

    expect(res.status).toBe(403);
  });

  it('returns formatted submissions for the requesting user', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1', role: 'STUDENT' } });
    prismaMock.submission.findMany.mockResolvedValue([
      {
        id: 's1',
        submittedAt: new Date('2025-01-01T00:00:00.000Z'),
        feedback: 'Nice',
        correct: true,
        fileName: 'file.jff',
        originalFileName: 'orig.jff',
        problemId: 'problem-1',
      },
    ]);

    const req = new NextRequest('http://localhost/api/problems/problem-1/submissions');
    const res = await GET(req, { params: Promise.resolve({ id: 'problem-1' }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([
      {
        id: 's1',
        submittedAt: '2025-01-01T00:00:00.000Z',
        feedback: 'Nice',
        correct: true,
        fileName: 'file.jff',
        originalFileName: 'orig.jff',
        problemId: 'problem-1',
        status: 'SUBMITTED',
      },
    ]);
  });
});
