import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const prismaMock = vi.hoisted(() => ({
  group: { findUnique: vi.fn() },
  roster: { findMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn() },
  groupRoster: { findMany: vi.fn(), createMany: vi.fn(), deleteMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), upsert: vi.fn() },
  user: { findUnique: vi.fn() },
}));

const authMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));

import { GET, POST, PATCH } from './route';

beforeEach(() => vi.clearAllMocks());

describe('GET /api/courses/[id]/groups/[groupId]/members', () => {
  it('returns 404 when group not found', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    prismaMock.group.findUnique.mockResolvedValue(null);

    const res = await GET(new NextRequest('http://localhost/api/courses/c1/groups/g1/members'), { params: Promise.resolve({ id: 'c1', groupId: 'g1' }) } as any);
    expect(res.status).toBe(404);
  });

  it('returns members payload', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    prismaMock.group.findUnique.mockResolvedValue({ id: 'g1', courseId: 'c1' });
    prismaMock.groupRoster.findMany.mockResolvedValue([{ userId: 'u2', id: 'r1' }]);

    const res = await GET(new NextRequest('http://localhost/api/courses/c1/groups/g1/members'), { params: Promise.resolve({ id: 'c1', groupId: 'g1' }) } as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.members)).toBe(true);
  });
});

describe('POST /api/courses/[id]/groups/[groupId]/members', () => {
  it('validates user existence and enrollment', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    prismaMock.group.findUnique.mockResolvedValue({ id: 'g1', courseId: 'c1' });
    prismaMock.roster.findUnique = vi.fn().mockResolvedValue(null);
    prismaMock.user = { findUnique: vi.fn().mockResolvedValue({ id: 'u2' }) } as any;

    const req = new NextRequest('http://localhost/api/courses/c1/groups/g1/members', { method: 'POST', body: JSON.stringify({ userId: 'u2' }) });
    const res = await POST(req, { params: Promise.resolve({ id: 'c1', groupId: 'g1' }) } as any);
    expect(res.status).toBe(422);
  });

  it('adds member and logs', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    prismaMock.group.findUnique.mockResolvedValue({ id: 'g1', courseId: 'c1' });
    prismaMock.user = { findUnique: vi.fn().mockResolvedValue({ id: 'u2' }) } as any;
    prismaMock.roster.findUnique.mockResolvedValue({ userId: 'u2' });
    prismaMock.groupRoster.findUnique = vi.fn().mockResolvedValue(null);
    prismaMock.groupRoster.upsert.mockResolvedValue({ id: 'r1', userId: 'u2' } as any);

    const req = new NextRequest('http://localhost/api/courses/c1/groups/g1/members', { method: 'POST', body: JSON.stringify({ userId: 'u2' }) });
    const res = await POST(req, { params: Promise.resolve({ id: 'c1', groupId: 'g1' }) } as any);

    expect(res.status).toBe(201);
    expect(activityLogMock).toHaveBeenCalled();
  });
});

describe('PATCH /api/courses/[id]/groups/[groupId]/members (bulk)', () => {
  it('validates members array', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });

    const req = new NextRequest('http://localhost/api/courses/c1/groups/g1/members', { method: 'PATCH', body: JSON.stringify({}) });
    const res = await PATCH(req, { params: Promise.resolve({ id: 'c1', groupId: 'g1' }) } as any);
    expect(res.status).toBe(422);
  });

  it('adds/removes members and logs', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    prismaMock.group.findUnique.mockResolvedValue({ id: 'g1', courseId: 'c1' });
    prismaMock.roster.findMany.mockResolvedValue([{ userId: 'u2' } as any]);
    prismaMock.groupRoster.findMany.mockResolvedValue([{ userId: 'u3' } as any]);
    prismaMock.groupRoster.createMany.mockResolvedValue({} as any);
    prismaMock.groupRoster.deleteMany.mockResolvedValue({} as any);

    const req = new NextRequest('http://localhost/api/courses/c1/groups/g1/members', { method: 'PATCH', body: JSON.stringify({ members: ['u2'] }) });
    const res = await PATCH(req, { params: Promise.resolve({ id: 'c1', groupId: 'g1' }) } as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.added).toEqual(['u2']);
  });
});
