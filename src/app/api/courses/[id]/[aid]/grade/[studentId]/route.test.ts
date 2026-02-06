import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const prismaMock = vi.hoisted(() => ({
  assignmentGrade: {
    findUnique: vi.fn(),
    deleteMany: vi.fn(),
    upsert: vi.fn(),
  },
}));

const authMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));

import { GET, POST } from './route';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/courses/[id]/[aid]/grade/[studentId]', () => {
  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/courses/c1/a1/grade/s1');
    const res = await GET(req, {
      params: Promise.resolve({ id: 'c1', aid: 'a1', studentId: 's1' }),
    });

    expect(res.status).toBe(401);
  });

  it('returns 403 when forbidden', async () => {
    authMock.mockResolvedValue({ user: { id: 'u2', role: 'STUDENT' } });

    const req = new NextRequest('http://localhost/api/courses/c1/a1/grade/s1');
    const res = await GET(req, {
      params: Promise.resolve({ id: 'c1', aid: 'a1', studentId: 's1' }),
    });

    expect(res.status).toBe(403);
  });

  it('returns grade when found', async () => {
    authMock.mockResolvedValue({ user: { id: 's1', role: 'STUDENT' } });
    prismaMock.assignmentGrade.findUnique.mockResolvedValue({
      grade: 90,
      feedback: 'ok',
      updatedAt: new Date(),
    });

    const req = new NextRequest('http://localhost/api/courses/c1/a1/grade/s1');
    const res = await GET(req, {
      params: Promise.resolve({ id: 'c1', aid: 'a1', studentId: 's1' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.grade).toBe(90);
  });
});

describe('POST /api/courses/[id]/[aid]/grade/[studentId]', () => {
  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/courses/c1/a1/grade/s1', {
      method: 'POST',
      body: JSON.stringify({ grade: 80 }),
    });
    const res = await POST(req, {
      params: Promise.resolve({ id: 'c1', aid: 'a1', studentId: 's1' }),
    });

    expect(res.status).toBe(401);
  });

  it('returns 403 when forbidden', async () => {
    authMock.mockResolvedValue({ user: { id: 'u2', role: 'STUDENT' } });

    const req = new NextRequest('http://localhost/api/courses/c1/a1/grade/s1', {
      method: 'POST',
      body: JSON.stringify({ grade: 80 }),
    });
    const res = await POST(req, {
      params: Promise.resolve({ id: 'c1', aid: 'a1', studentId: 's1' }),
    });

    expect(res.status).toBe(403);
  });

  it('returns 400 on invalid grade', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'TA' } });

    const req = new NextRequest('http://localhost/api/courses/c1/a1/grade/s1', {
      method: 'POST',
      body: JSON.stringify({ grade: 200 }),
    });
    const res = await POST(req, {
      params: Promise.resolve({ id: 'c1', aid: 'a1', studentId: 's1' }),
    });

    expect(res.status).toBe(400);
  });

  it('clears grade when null', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });

    const req = new NextRequest('http://localhost/api/courses/c1/a1/grade/s1', {
      method: 'POST',
      body: JSON.stringify({ grade: null }),
    });
    const res = await POST(req, {
      params: Promise.resolve({ id: 'c1', aid: 'a1', studentId: 's1' }),
    });

    expect(res.status).toBe(200);
    expect(prismaMock.assignmentGrade.deleteMany).toHaveBeenCalled();
  });

  it('upserts grade when valid', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    prismaMock.assignmentGrade.upsert.mockResolvedValue({
      grade: 88,
      feedback: null,
      updatedAt: new Date(),
    });

    const req = new NextRequest('http://localhost/api/courses/c1/a1/grade/s1', {
      method: 'POST',
      body: JSON.stringify({ grade: 88 }),
    });
    const res = await POST(req, {
      params: Promise.resolve({ id: 'c1', aid: 'a1', studentId: 's1' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.grade).toBe(88);
  });
});
