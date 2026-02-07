import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const prismaMock = vi.hoisted(() => ({
  group: { findUnique: vi.fn() },
  groupRoster: { findMany: vi.fn(), create: vi.fn(), findUnique: vi.fn() },
  user: { findUnique: vi.fn() },
  roster: { findFirst: vi.fn() },
}));

const authMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));

import { GET, POST } from './route';

beforeEach(() => vi.clearAllMocks());

describe('GET /api/groups/[gid]/members', () => {
  it('returns 400 when missing ids', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });

    const res = await GET(new NextRequest('http://localhost/api/groups//members'), { params: Promise.resolve({ id: '', gid: '' }) } as any);

    expect(res.status).toBe(400);
  });

  it('returns 403 for non-staff', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });

    const res = await GET(new NextRequest('http://localhost/api/groups/g1/members'), { params: Promise.resolve({ id: 'c1', gid: 'g1' }) } as any);

    expect(res.status).toBe(403);
  });

  it('returns members', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    prismaMock.group.findUnique.mockResolvedValue({ id: 'g1', courseId: 'c1' });
    prismaMock.groupRoster.findMany.mockResolvedValue([
      { id: 'r1', userId: 'u2', createdAt: new Date('2020-01-01'), user: { id: 'u2', firstName: 'A', lastName: 'B', email: 'a@b.com', avatar: null } },
    ]);

    const res = await GET(new NextRequest('http://localhost/api/groups/g1/members'), { params: Promise.resolve({ id: 'c1', gid: 'g1' }) } as any);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.members).toHaveLength(1);
  });
});

describe('POST /api/groups/[gid]/members', () => {
  it('returns 400 when missing ids', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });

    const res = await POST(new NextRequest('http://localhost/api/groups//members', { method: 'POST' }), { params: Promise.resolve({ id: '', gid: '' }) } as any);

    expect(res.status).toBe(400);
  });

  it('returns 404 when user not found', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    prismaMock.group.findUnique.mockResolvedValue({ id: 'g1', courseId: 'c1' });
    prismaMock.user.findUnique.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/groups/g1/members', { method: 'POST', body: JSON.stringify({ userId: 'u2' }) });
    const res = await POST(req, { params: Promise.resolve({ id: 'c1', gid: 'g1' }) } as any);

    expect(res.status).toBe(404);
  });

  it('returns 422 when not enrolled', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    prismaMock.group.findUnique.mockResolvedValue({ id: 'g1', courseId: 'c1' });
    prismaMock.user.findUnique.mockResolvedValue({ id: 'u2' });
    prismaMock.roster.findFirst.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/groups/g1/members', { method: 'POST', body: JSON.stringify({ userId: 'u2' }) });
    const res = await POST(req, { params: Promise.resolve({ id: 'c1', gid: 'g1' }) } as any);

    expect(res.status).toBe(422);
  });

  it('creates and logs', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    prismaMock.group.findUnique.mockResolvedValue({ id: 'g1', courseId: 'c1' });
    prismaMock.user.findUnique.mockResolvedValue({ id: 'u2' });
    prismaMock.roster.findFirst.mockResolvedValue({ userId: 'u2' });
    prismaMock.groupRoster.findUnique.mockResolvedValue(null);
    prismaMock.groupRoster.create.mockResolvedValue({ id: 'r1', userId: 'u2' });

    const req = new NextRequest('http://localhost/api/groups/g1/members', { method: 'POST', body: JSON.stringify({ userId: 'u2' }) });
    const res = await POST(req, { params: Promise.resolve({ id: 'c1', gid: 'g1' }) } as any);

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.member.userId).toBe('u2');
    expect(activityLogMock).toHaveBeenCalled();
  });
});
