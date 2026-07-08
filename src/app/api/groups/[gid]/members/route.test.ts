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

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.roster.findFirst.mockResolvedValue(null);
});

describe('GET /api/groups/[gid]/members', () => {
  it('returns 400 when missing ids', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });

    const res = await GET(new NextRequest('http://localhost/api/groups//members'), {
      params: Promise.resolve({ id: '', gid: '' }),
    } as any);

    expect(res.status).toBe(400);
  });

  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);

    const res = await GET(new NextRequest('http://localhost/api/groups/g1/members'), {
      params: Promise.resolve({ id: 'c1', gid: 'g1' }),
    } as any);

    expect(res.status).toBe(401);
  });

  it('returns 403 for non-staff', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });
    prismaMock.group.findUnique.mockResolvedValue({ id: 'g1', courseId: 'c1' });

    const res = await GET(new NextRequest('http://localhost/api/groups/g1/members'), {
      params: Promise.resolve({ id: 'c1', gid: 'g1' }),
    } as any);

    expect(res.status).toBe(403);
  });

  it('returns members', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });
    prismaMock.group.findUnique.mockResolvedValue({ id: 'g1', courseId: 'c1' });
    prismaMock.groupRoster.findMany.mockResolvedValue([
      {
        id: 'r1',
        userId: 'u2',
        createdAt: new Date('2020-01-01'),
        user: { id: 'u2', firstName: 'A', lastName: 'B', email: 'a@b.com', avatar: null },
      },
    ]);

    const res = await GET(new NextRequest('http://localhost/api/groups/g1/members'), {
      params: Promise.resolve({ id: 'c1', gid: 'g1' }),
    } as any);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.members).toHaveLength(1);
  });

  it('returns 404 when group not found', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });
    prismaMock.group.findUnique.mockResolvedValue(null);

    const res = await GET(new NextRequest('http://localhost/api/groups/g1/members'), {
      params: Promise.resolve({ id: 'c1', gid: 'g1' }),
    } as any);

    expect(res.status).toBe(404);
  });

  it('returns 404 when group does not match provided course', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });
    prismaMock.group.findUnique.mockResolvedValue({ id: 'g1', courseId: 'other' });

    const res = await GET(new NextRequest('http://localhost/api/groups/g1/members'), {
      params: Promise.resolve({ id: 'c1', gid: 'g1' }),
    } as any);

    expect(res.status).toBe(404);
  });

  it('returns 500 when fetching members fails', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });
    prismaMock.group.findUnique.mockResolvedValue({ id: 'g1', courseId: 'c1' });
    prismaMock.groupRoster.findMany.mockRejectedValue(new Error('db fail'));

    const res = await GET(new NextRequest('http://localhost/api/groups/g1/members'), {
      params: Promise.resolve({ id: 'c1', gid: 'g1' }),
    } as any);

    expect(res.status).toBe(500);
  });
});

describe('POST /api/groups/[gid]/members', () => {
  it('returns 400 when missing ids', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });

    const res = await POST(
      new NextRequest('http://localhost/api/groups//members', { method: 'POST' }),
      { params: Promise.resolve({ id: '', gid: '' }) } as any,
    );

    expect(res.status).toBe(400);
  });

  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/groups/g1/members', {
      method: 'POST',
      body: JSON.stringify({ userId: 'u2' }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'c1', gid: 'g1' }) } as any);

    expect(res.status).toBe(401);
  });

  it('returns 403 when non-staff user attempts add', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });
    prismaMock.group.findUnique.mockResolvedValue({ id: 'g1', courseId: 'c1' });

    const req = new NextRequest('http://localhost/api/groups/g1/members', {
      method: 'POST',
      body: JSON.stringify({ userId: 'u2' }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'c1', gid: 'g1' }) } as any);

    expect(res.status).toBe(403);
  });

  it('returns 404 when group not found', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });
    prismaMock.group.findUnique.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/groups/g1/members', {
      method: 'POST',
      body: JSON.stringify({ userId: 'u2' }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'c1', gid: 'g1' }) } as any);

    expect(res.status).toBe(404);
  });

  it('returns 404 when group course mismatch', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });
    prismaMock.group.findUnique.mockResolvedValue({ id: 'g1', courseId: 'other' });

    const req = new NextRequest('http://localhost/api/groups/g1/members', {
      method: 'POST',
      body: JSON.stringify({ userId: 'u2' }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'c1', gid: 'g1' }) } as any);

    expect(res.status).toBe(404);
  });

  it('returns 404 when user not found', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });
    prismaMock.group.findUnique.mockResolvedValue({ id: 'g1', courseId: 'c1' });
    prismaMock.user.findUnique.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/groups/g1/members', {
      method: 'POST',
      body: JSON.stringify({ userId: 'u2' }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'c1', gid: 'g1' }) } as any);

    expect(res.status).toBe(404);
  });

  it('finds user by email when userId is absent', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });
    prismaMock.group.findUnique.mockResolvedValue({ id: 'g1', courseId: 'c1' });
    prismaMock.user.findUnique.mockResolvedValue({ id: 'u2', email: 'user@example.com' });
    prismaMock.roster.findFirst.mockResolvedValue({ userId: 'u2' });
    prismaMock.groupRoster.findUnique.mockResolvedValue(null);
    prismaMock.groupRoster.create.mockResolvedValue({ id: 'r1', userId: 'u2' });

    const req = new NextRequest('http://localhost/api/groups/g1/members', {
      method: 'POST',
      body: JSON.stringify({ email: 'user@example.com' }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'c1', gid: 'g1' }) } as any);

    expect(res.status).toBe(201);
    expect(prismaMock.user.findUnique).toHaveBeenCalledTimes(1);
  });

  it('returns 422 when not enrolled', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });
    prismaMock.group.findUnique.mockResolvedValue({ id: 'g1', courseId: 'c1' });
    prismaMock.user.findUnique.mockResolvedValue({ id: 'u2' });
    prismaMock.roster.findFirst.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/groups/g1/members', {
      method: 'POST',
      body: JSON.stringify({ userId: 'u2' }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'c1', gid: 'g1' }) } as any);

    expect(res.status).toBe(422);
  });

  it('creates and logs', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });
    prismaMock.group.findUnique.mockResolvedValue({ id: 'g1', courseId: 'c1' });
    prismaMock.user.findUnique.mockResolvedValue({ id: 'u2' });
    prismaMock.roster.findFirst.mockResolvedValue({ userId: 'u2' });
    prismaMock.groupRoster.findUnique.mockResolvedValue(null);
    prismaMock.groupRoster.create.mockResolvedValue({ id: 'r1', userId: 'u2' });

    const req = new NextRequest('http://localhost/api/groups/g1/members', {
      method: 'POST',
      body: JSON.stringify({ userId: 'u2' }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'c1', gid: 'g1' }) } as any);

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.member.userId).toBe('u2');
    expect(activityLogMock).toHaveBeenCalled();
  });

  it('returns 409 when user already in group', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });
    prismaMock.group.findUnique.mockResolvedValue({ id: 'g1', courseId: 'c1' });
    prismaMock.user.findUnique.mockResolvedValue({ id: 'u2' });
    prismaMock.roster.findFirst.mockResolvedValue({ userId: 'u2' });
    prismaMock.groupRoster.findUnique.mockResolvedValue({ id: 'r1', userId: 'u2' });

    const req = new NextRequest('http://localhost/api/groups/g1/members', {
      method: 'POST',
      body: JSON.stringify({ userId: 'u2' }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'c1', gid: 'g1' }) } as any);

    expect(res.status).toBe(409);
  });

  it('returns 500 on unexpected errors', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });
    prismaMock.group.findUnique.mockRejectedValue(new Error('boom'));

    const req = new NextRequest('http://localhost/api/groups/g1/members', {
      method: 'POST',
      body: JSON.stringify({ userId: 'u2' }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'c1', gid: 'g1' }) } as any);

    expect(res.status).toBe(500);
  });
});
