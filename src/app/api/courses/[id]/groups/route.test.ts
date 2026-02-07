import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const prismaMock = vi.hoisted(() => ({
  group: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn() },
  course: { findUnique: vi.fn() },
}));

const authMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));

import { GET, POST } from './route';

beforeEach(() => vi.clearAllMocks());

describe('GET /api/courses/[id]/groups', () => {
  it('returns 400 when missing course id', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });

    const res = await GET(new NextRequest('http://localhost/api/courses//groups'), { params: { id: '' } } as any);
    expect(res.status).toBe(400);
  });

  it('returns groups for course', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    prismaMock.group.findMany.mockResolvedValue([{ id: 'g1', name: 'A' }]);

    const res = await GET(new NextRequest('http://localhost/api/courses/c1/groups'), { params: { id: 'c1' } } as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([{ id: 'g1', name: 'A' }]);
    expect(activityLogMock).toHaveBeenCalled();
  });
});

describe('POST /api/courses/[id]/groups', () => {
  it('returns 422 when name missing', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });

    const res = await POST(new NextRequest('http://localhost/api/courses/c1/groups', { method: 'POST', body: JSON.stringify({}) }), { params: { id: 'c1' } } as any);
    expect(res.status).toBe(422);
  });

  it('creates group', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    prismaMock.course.findUnique.mockResolvedValue({ id: 'c1' });
    prismaMock.group.findUnique.mockResolvedValue(null);
    prismaMock.group.create.mockResolvedValue({ id: 'g1', name: 'New' });

    const res = await POST(new NextRequest('http://localhost/api/courses/c1/groups', { method: 'POST', body: JSON.stringify({ name: 'New' }) }), { params: { id: 'c1' } } as any);

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toEqual({ id: 'g1', name: 'New' });
    expect(activityLogMock).toHaveBeenCalled();
  });
});
