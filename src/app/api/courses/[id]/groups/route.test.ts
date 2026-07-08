import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const prismaMock = vi.hoisted(() => ({
  group: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn() },
  course: { findUnique: vi.fn() },
  roster: { findFirst: vi.fn() },
}));

const authMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));

import { GET, POST } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.roster.findFirst.mockResolvedValue(null);
});

describe('GET /api/courses/[id]/groups', () => {
  it('returns 400 when missing course id', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });

    const res = await GET(new NextRequest('http://localhost/api/courses//groups'), {
      params: { id: '' },
    } as any);
    expect(res.status).toBe(400);
  });

  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);

    const res = await GET(new NextRequest('http://localhost/api/courses/c1/groups'), {
      params: { id: 'c1' },
    } as any);
    expect(res.status).toBe(401);
  });

  it('returns 403 for disallowed role', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });

    const res = await GET(new NextRequest('http://localhost/api/courses/c1/groups'), {
      params: { id: 'c1' },
    } as any);
    expect(res.status).toBe(403);
  });

  it('returns groups for course', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });
    prismaMock.group.findMany.mockResolvedValue([{ id: 'g1', name: 'A' }]);

    const res = await GET(new NextRequest('http://localhost/api/courses/c1/groups'), {
      params: { id: 'c1' },
    } as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([{ id: 'g1', name: 'A' }]);
    expect(activityLogMock).toHaveBeenCalled();
  });

  it('returns 500 when fetching groups fails', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });
    prismaMock.group.findMany.mockRejectedValue(new Error('db fail'));

    const res = await GET(new NextRequest('http://localhost/api/courses/c1/groups'), {
      params: { id: 'c1' },
    } as any);
    expect(res.status).toBe(500);
  });
});

describe('POST /api/courses/[id]/groups', () => {
  it('returns 400 when missing course id', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });

    const res = await POST(
      new NextRequest('http://localhost/api/courses//groups', {
        method: 'POST',
        body: JSON.stringify({ name: 'A' }),
      }),
      { params: { id: '' } } as any,
    );
    expect(res.status).toBe(400);
  });

  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);

    const res = await POST(
      new NextRequest('http://localhost/api/courses/c1/groups', {
        method: 'POST',
        body: JSON.stringify({ name: 'A' }),
      }),
      { params: { id: 'c1' } } as any,
    );
    expect(res.status).toBe(401);
  });

  it('returns 403 for disallowed role', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });

    const res = await POST(
      new NextRequest('http://localhost/api/courses/c1/groups', {
        method: 'POST',
        body: JSON.stringify({ name: 'A' }),
      }),
      { params: { id: 'c1' } } as any,
    );
    expect(res.status).toBe(403);
  });

  it('returns 422 when name missing', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });

    const res = await POST(
      new NextRequest('http://localhost/api/courses/c1/groups', {
        method: 'POST',
        body: JSON.stringify({}),
      }),
      { params: { id: 'c1' } } as any,
    );
    expect(res.status).toBe(422);
  });

  it('returns 404 when course does not exist', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });
    prismaMock.course.findUnique.mockResolvedValue(null);

    const res = await POST(
      new NextRequest('http://localhost/api/courses/c1/groups', {
        method: 'POST',
        body: JSON.stringify({ name: 'New' }),
      }),
      { params: { id: 'c1' } } as any,
    );
    expect(res.status).toBe(404);
  });

  it('returns 409 when duplicate group name exists', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });
    prismaMock.course.findUnique.mockResolvedValue({ id: 'c1' });
    prismaMock.group.findUnique.mockResolvedValue({ id: 'g1', courseId: 'c1', name: 'New' });

    const res = await POST(
      new NextRequest('http://localhost/api/courses/c1/groups', {
        method: 'POST',
        body: JSON.stringify({ name: 'New' }),
      }),
      { params: { id: 'c1' } } as any,
    );
    expect(res.status).toBe(409);
  });

  it('creates group', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });
    prismaMock.course.findUnique.mockResolvedValue({ id: 'c1' });
    prismaMock.group.findUnique.mockResolvedValue(null);
    prismaMock.group.create.mockResolvedValue({ id: 'g1', name: 'New' });

    const res = await POST(
      new NextRequest('http://localhost/api/courses/c1/groups', {
        method: 'POST',
        body: JSON.stringify({ name: 'New' }),
      }),
      { params: { id: 'c1' } } as any,
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toEqual({ id: 'g1', name: 'New' });
    expect(activityLogMock).toHaveBeenCalled();
  });

  it('returns 500 on invalid JSON body', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });

    const res = await POST(
      new NextRequest('http://localhost/api/courses/c1/groups', {
        method: 'POST',
        body: '{bad',
      }),
      { params: { id: 'c1' } } as any,
    );
    expect(res.status).toBe(500);
  });

  it('returns 500 when create throws', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });
    prismaMock.course.findUnique.mockResolvedValue({ id: 'c1' });
    prismaMock.group.findUnique.mockResolvedValue(null);
    prismaMock.group.create.mockRejectedValue(new Error('create fail'));

    const res = await POST(
      new NextRequest('http://localhost/api/courses/c1/groups', {
        method: 'POST',
        body: JSON.stringify({ name: 'New' }),
      }),
      { params: { id: 'c1' } } as any,
    );
    expect(res.status).toBe(500);
  });
});
