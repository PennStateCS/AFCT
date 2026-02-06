import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const prismaMock = vi.hoisted(() => ({
  assignmentGrade: { findUnique: vi.fn() },
}));

const authMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));

import { GET } from './route';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/assignments/[id]/grade', () => {
  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/assignments/a1/grade');
    const res = await GET(req, { params: Promise.resolve({ id: 'a1' }) });

    expect(res.status).toBe(401);
  });

  it('returns 403 when requesting another user without permission', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });

    const req = new NextRequest('http://localhost/api/assignments/a1/grade?userId=u2');
    const res = await GET(req, { params: Promise.resolve({ id: 'a1' }) });

    expect(res.status).toBe(403);
  });

  it('returns grade when present', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });
    prismaMock.assignmentGrade.findUnique.mockResolvedValue({
      grade: 90,
      feedback: 'ok',
      updatedAt: new Date('2025-01-01T00:00:00.000Z'),
    });

    const req = new NextRequest('http://localhost/api/assignments/a1/grade');
    const res = await GET(req, { params: Promise.resolve({ id: 'a1' }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ grade: 90, feedback: 'ok' });
  });

  it('returns null when no grade exists', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });
    prismaMock.assignmentGrade.findUnique.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/assignments/a1/grade');
    const res = await GET(req, { params: Promise.resolve({ id: 'a1' }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ grade: null });
  });
});
