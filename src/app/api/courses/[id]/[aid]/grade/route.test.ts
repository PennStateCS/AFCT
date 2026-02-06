import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const prismaMock = vi.hoisted(() => ({
  activityLog: { create: vi.fn() },
}));

const authMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));

import { POST } from './route';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/courses/[id]/[aid]/grade', () => {
  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/courses/c1/a1/grade', {
      method: 'POST',
      body: JSON.stringify({ studentId: 's1', grade: 90 }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'c1', aid: 'a1' }) });

    expect(res.status).toBe(401);
  });

  it('returns 403 when forbidden', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });

    const req = new NextRequest('http://localhost/api/courses/c1/a1/grade', {
      method: 'POST',
      body: JSON.stringify({ studentId: 's1', grade: 90 }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'c1', aid: 'a1' }) });

    expect(res.status).toBe(403);
  });

  it('returns 400 on invalid payload', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });

    const req = new NextRequest('http://localhost/api/courses/c1/a1/grade', {
      method: 'POST',
      body: JSON.stringify({ studentId: 's1', grade: 'bad' }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'c1', aid: 'a1' }) });

    expect(res.status).toBe(400);
  });

  it('logs grade set', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });

    const req = new NextRequest('http://localhost/api/courses/c1/a1/grade', {
      method: 'POST',
      body: JSON.stringify({ studentId: 's1', grade: 95 }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'c1', aid: 'a1' }) });

    expect(res.status).toBe(200);
    expect(prismaMock.activityLog.create).toHaveBeenCalled();
  });
});
