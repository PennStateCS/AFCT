import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const prismaMock = vi.hoisted(() => ({
  course: { findUnique: vi.fn() },
  problem: { create: vi.fn(), findMany: vi.fn() },
}));

const authMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());
const uploadLimitMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));
vi.mock('@/lib/upload-limits', () => ({ getSystemUploadLimit: uploadLimitMock }));
vi.mock('fs/promises', () => ({ writeFile: vi.fn(), mkdir: vi.fn() }));
vi.mock('uuid', () => ({ v4: vi.fn().mockReturnValue('uuid') }));

import { GET, POST } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  uploadLimitMock.mockResolvedValue({ maxBytes: 5 * 1024 * 1024, maxMb: 5 });
});

describe('POST /api/courses/[id]/problems', () => {
  it('returns 403 when unauthorized', async () => {
    authMock.mockResolvedValue(null);

    const formData = new FormData();
    formData.set('title', 'Problem');
    formData.set('type', 'FA');
    formData.set('file', new File([new Uint8Array([1])], 'file.jff'));

    const req = new NextRequest('http://localhost/api/courses/c1/problems', {
      method: 'POST',
      body: formData,
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(403);
  });

  it('returns 400 when required fields missing', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });

    const formData = new FormData();
    formData.set('title', 'Problem');

    const req = new NextRequest('http://localhost/api/courses/c1/problems', {
      method: 'POST',
      body: formData,
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(400);
  });

  it('returns 404 when course not found', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    prismaMock.course.findUnique.mockResolvedValue(null);

    const formData = new FormData();
    formData.set('title', 'Problem');
    formData.set('type', 'FA');
    formData.set('file', new File([new Uint8Array([1])], 'file.jff'));

    const req = new NextRequest('http://localhost/api/courses/c1/problems', {
      method: 'POST',
      body: formData,
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(404);
  });

  it('creates problem and logs activity', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    prismaMock.course.findUnique.mockResolvedValue({ id: 'c1' });
    prismaMock.problem.create.mockResolvedValue({ id: 'p1', title: 'Problem' });

    const formData = new FormData();
    formData.set('title', 'Problem');
    formData.set('type', 'FA');
    formData.set('file', new File([new Uint8Array([1])], 'file.jff'));

    const req = new NextRequest('http://localhost/api/courses/c1/problems', {
      method: 'POST',
      body: formData,
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(201);
    expect(prismaMock.problem.create).toHaveBeenCalled();
    expect(activityLogMock).toHaveBeenCalled();
  });
});

describe('GET /api/courses/[id]/problems', () => {
  it('returns problems list', async () => {
    prismaMock.problem.findMany.mockResolvedValue([{ id: 'p1' }]);

    const req = new NextRequest('http://localhost/api/courses/c1/problems');
    const res = await GET(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([{ id: 'p1' }]);
  });
});
