import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const prismaMock = vi.hoisted(() => ({
  group: { findUnique: vi.fn() },
  groupRoster: { findUnique: vi.fn(), delete: vi.fn() },
  roster: { findFirst: vi.fn() },
}));

const authMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));

import { DELETE } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.roster.findFirst.mockResolvedValue(null);
});

describe('DELETE /api/groups/[gid]/members/[uid]', () => {
  it('returns 400 when missing ids', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });

    const res = await DELETE(new NextRequest('http://localhost/api/groups//members/'), {
      params: Promise.resolve({ id: '', gid: '', uid: '' }),
    } as any);

    expect(res.status).toBe(400);
  });

  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);

    const res = await DELETE(new NextRequest('http://localhost/api/groups/g1/members/u2'), {
      params: Promise.resolve({ id: 'c1', gid: 'g1', uid: 'u2' }),
    } as any);

    expect(res.status).toBe(401);
  });

  it('returns 403 for non-staff user', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });
    prismaMock.group.findUnique.mockResolvedValue({ id: 'g1', courseId: 'c1' });

    const res = await DELETE(new NextRequest('http://localhost/api/groups/g1/members/u2'), {
      params: Promise.resolve({ id: 'c1', gid: 'g1', uid: 'u2' }),
    } as any);

    expect(res.status).toBe(403);
  });

  it('returns 404 when group is not found', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });
    prismaMock.group.findUnique.mockResolvedValue(null);

    const res = await DELETE(new NextRequest('http://localhost/api/groups/g1/members/u2'), {
      params: Promise.resolve({ id: 'c1', gid: 'g1', uid: 'u2' }),
    } as any);

    expect(res.status).toBe(404);
  });

  it('returns 404 when group does not belong to provided course', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });
    prismaMock.group.findUnique.mockResolvedValue({ id: 'g1', courseId: 'c2' });

    const res = await DELETE(new NextRequest('http://localhost/api/groups/g1/members/u2'), {
      params: Promise.resolve({ id: 'c1', gid: 'g1', uid: 'u2' }),
    } as any);

    expect(res.status).toBe(404);
  });

  it('returns 404 when membership not found', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });
    prismaMock.group.findUnique.mockResolvedValue({ id: 'g1', courseId: 'c1' });
    prismaMock.groupRoster.findUnique.mockResolvedValue(null);

    const res = await DELETE(new NextRequest('http://localhost/api/groups/g1/members/u2'), {
      params: Promise.resolve({ id: 'c1', gid: 'g1', uid: 'u2' }),
    } as any);

    expect(res.status).toBe(404);
  });

  it('deletes membership and logs', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });
    prismaMock.group.findUnique.mockResolvedValue({ id: 'g1', courseId: 'c1' });
    prismaMock.groupRoster.findUnique.mockResolvedValue({ id: 'r1' });
    prismaMock.groupRoster.delete.mockResolvedValue({ id: 'r1' });

    const res = await DELETE(new NextRequest('http://localhost/api/groups/g1/members/u2'), {
      params: Promise.resolve({ id: 'c1', gid: 'g1', uid: 'u2' }),
    } as any);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true });
    expect(activityLogMock).toHaveBeenCalled();
  });

  it('returns 500 when delete operation fails', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });
    prismaMock.group.findUnique.mockResolvedValue({ id: 'g1', courseId: 'c1' });
    prismaMock.groupRoster.findUnique.mockResolvedValue({ id: 'r1' });
    prismaMock.groupRoster.delete.mockRejectedValue(new Error('delete failed'));

    const res = await DELETE(new NextRequest('http://localhost/api/groups/g1/members/u2'), {
      params: Promise.resolve({ id: 'c1', gid: 'g1', uid: 'u2' }),
    } as any);

    expect(res.status).toBe(500);
  });
});
