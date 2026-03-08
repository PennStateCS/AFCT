import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const prismaMock = vi.hoisted(() => ({
  group: { findUnique: vi.fn() },
  groupRoster: { findUnique: vi.fn(), deleteMany: vi.fn() },
}));

const authMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));

import { DELETE } from './route';

beforeEach(() => vi.clearAllMocks());

describe('DELETE /api/courses/[id]/groups/[groupId]/members/[userId]', () => {
  it('returns 400 when missing params', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });

    const res = await DELETE(new NextRequest('http://localhost/api/courses//groups//members/'), {
      params: Promise.resolve({ id: '', groupId: '', userId: '' }),
    } as any);
    expect(res.status).toBe(400);
  });

  it('returns 404 when membership not found', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    prismaMock.group.findUnique.mockResolvedValue({ id: 'g1', courseId: 'c1' });
    prismaMock.groupRoster.findUnique.mockResolvedValue(null);

    const res = await DELETE(
      new NextRequest('http://localhost/api/courses/c1/groups/g1/members/u2'),
      { params: Promise.resolve({ id: 'c1', groupId: 'g1', userId: 'u2' }) } as any,
    );
    expect(res.status).toBe(404);
  });

  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);

    const res = await DELETE(
      new NextRequest('http://localhost/api/courses/c1/groups/g1/members/u2'),
      { params: Promise.resolve({ id: 'c1', groupId: 'g1', userId: 'u2' }) } as any,
    );

    expect(res.status).toBe(401);
  });

  it('returns 403 for insufficient role', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });

    const res = await DELETE(
      new NextRequest('http://localhost/api/courses/c1/groups/g1/members/u2'),
      { params: Promise.resolve({ id: 'c1', groupId: 'g1', userId: 'u2' }) } as any,
    );

    expect(res.status).toBe(403);
  });

  it('returns 404 when group is not in provided course', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    prismaMock.group.findUnique.mockResolvedValue({ id: 'g1', courseId: 'other-course' });

    const res = await DELETE(
      new NextRequest('http://localhost/api/courses/c1/groups/g1/members/u2'),
      { params: Promise.resolve({ id: 'c1', groupId: 'g1', userId: 'u2' }) } as any,
    );

    expect(res.status).toBe(404);
  });

  it('returns 500 when delete throws', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    prismaMock.group.findUnique.mockResolvedValue({ id: 'g1', courseId: 'c1' });
    prismaMock.groupRoster.findUnique.mockResolvedValue({ id: 'r1' });
    prismaMock.groupRoster.deleteMany.mockRejectedValue(new Error('db failed'));

    const res = await DELETE(
      new NextRequest('http://localhost/api/courses/c1/groups/g1/members/u2'),
      { params: Promise.resolve({ id: 'c1', groupId: 'g1', userId: 'u2' }) } as any,
    );

    expect(res.status).toBe(500);
  });

  it('deletes membership and logs', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    prismaMock.group.findUnique.mockResolvedValue({ id: 'g1', courseId: 'c1' });
    prismaMock.groupRoster.findUnique.mockResolvedValue({ id: 'r1' });
    prismaMock.groupRoster.deleteMany.mockResolvedValue({ count: 1 } as any);

    const res = await DELETE(
      new NextRequest('http://localhost/api/courses/c1/groups/g1/members/u2'),
      { params: Promise.resolve({ id: 'c1', groupId: 'g1', userId: 'u2' }) } as any,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true });
    expect(activityLogMock).toHaveBeenCalled();
  });
});
