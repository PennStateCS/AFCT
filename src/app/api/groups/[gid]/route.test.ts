import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const prismaMock = vi.hoisted(() => ({
  group: {
    findUnique: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  roster: { findFirst: vi.fn() },
}));

const authMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));

import { PATCH, DELETE } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.roster.findFirst.mockResolvedValue(null);
});

describe('PATCH /api/groups/[gid]', () => {
  it('returns 400 when missing params', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });

    const req = new NextRequest('http://localhost/api/groups//', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'New' }),
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: '', gid: '' }) } as any);

    expect(res.status).toBe(400);
  });

  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);
    const req = new NextRequest('http://localhost/api/groups/g1', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'New' }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: 'c1', gid: 'g1' }) } as any);
    expect(res.status).toBe(401);
  });

  it('returns 403 for insufficient role', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });
    prismaMock.group.findUnique.mockResolvedValue({ id: 'g1', courseId: 'c1' });
    const req = new NextRequest('http://localhost/api/groups/g1', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'New' }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: 'c1', gid: 'g1' }) } as any);
    expect(res.status).toBe(403);
  });

  it('returns 404 when group not found', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });
    prismaMock.group.findUnique.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/groups/g1', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'New' }),
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: 'c1', gid: 'g1' }) } as any);

    expect(res.status).toBe(404);
  });

  it('returns 400 for invalid payload', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });

    const req = new NextRequest('http://localhost/api/groups/g1', {
      method: 'PATCH',
      body: JSON.stringify({ name: '' }),
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: 'c1', gid: 'g1' }) } as any);

    expect(res.status).toBe(400);
  });

  it('returns 400 when group course mismatches provided course', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });
    prismaMock.group.findUnique.mockResolvedValue({ id: 'g1', courseId: 'other-course' });

    const req = new NextRequest('http://localhost/api/groups/g1', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'New' }),
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: 'c1', gid: 'g1' }) } as any);

    expect(res.status).toBe(400);
  });

  it('returns 409 when name already exists in course', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });
    prismaMock.group.findUnique.mockResolvedValueOnce({ id: 'g1', courseId: 'c1' });
    prismaMock.group.findUnique.mockResolvedValueOnce({ id: 'g2', courseId: 'c1', name: 'New' });

    const req = new NextRequest('http://localhost/api/groups/g1', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'New' }),
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: 'c1', gid: 'g1' }) } as any);

    expect(res.status).toBe(409);
  });

  it('returns 500 when update throws', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });
    prismaMock.group.findUnique.mockResolvedValueOnce({ id: 'g1', courseId: 'c1' });
    prismaMock.group.findUnique.mockResolvedValueOnce(null);
    prismaMock.group.update.mockRejectedValue(new Error('db failed'));

    const req = new NextRequest('http://localhost/api/groups/g1', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'New' }),
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: 'c1', gid: 'g1' }) } as any);

    expect(res.status).toBe(500);
  });

  it('updates group and logs activity', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });
    prismaMock.group.findUnique.mockResolvedValue({ id: 'g1', courseId: 'c1' });
    prismaMock.group.findUnique.mockResolvedValueOnce({ id: 'g1', courseId: 'c1' });
    prismaMock.group.findUnique.mockResolvedValueOnce(null);
    prismaMock.group.update.mockResolvedValue({ id: 'g1', name: 'New' });

    const req = new NextRequest('http://localhost/api/groups/g1', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'New' }),
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: 'c1', gid: 'g1' }) } as any);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ id: 'g1', name: 'New' });
    expect(activityLogMock).toHaveBeenCalled();
  });
});

describe('DELETE /api/groups/[gid]', () => {
  it('returns 400 when missing params', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });

    const res = await DELETE(new NextRequest('http://localhost/api/groups/'), {
      params: Promise.resolve({ id: '', gid: '' }),
    } as any);

    expect(res.status).toBe(400);
  });

  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);
    const res = await DELETE(new NextRequest('http://localhost/api/groups/g1'), {
      params: Promise.resolve({ id: 'c1', gid: 'g1' }),
    } as any);

    expect(res.status).toBe(401);
  });

  it('returns 403 for insufficient role', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });
    prismaMock.group.findUnique.mockResolvedValue({ id: 'g1', courseId: 'c1' });

    const res = await DELETE(new NextRequest('http://localhost/api/groups/g1'), {
      params: Promise.resolve({ id: 'c1', gid: 'g1' }),
    } as any);

    expect(res.status).toBe(403);
  });

  it('returns 404 when group not found', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });
    prismaMock.group.findUnique.mockResolvedValue(null);

    const res = await DELETE(new NextRequest('http://localhost/api/groups/g1'), {
      params: Promise.resolve({ id: 'c1', gid: 'g1' }),
    } as any);

    expect(res.status).toBe(404);
  });

  it('returns 400 when group course mismatches provided course', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });
    prismaMock.group.findUnique.mockResolvedValue({ id: 'g1', courseId: 'other-course' });

    const res = await DELETE(new NextRequest('http://localhost/api/groups/g1'), {
      params: Promise.resolve({ id: 'c1', gid: 'g1' }),
    } as any);

    expect(res.status).toBe(400);
  });

  it('returns 500 when delete throws', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });
    prismaMock.group.findUnique.mockResolvedValue({ id: 'g1', courseId: 'c1' });
    prismaMock.group.delete.mockRejectedValue(new Error('db failed'));

    const res = await DELETE(new NextRequest('http://localhost/api/groups/g1'), {
      params: Promise.resolve({ id: 'c1', gid: 'g1' }),
    } as any);

    expect(res.status).toBe(500);
  });

  it('deletes group and logs activity', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });
    prismaMock.group.findUnique.mockResolvedValue({ id: 'g1', courseId: 'c1' });
    prismaMock.group.delete.mockResolvedValue({ id: 'g1' });

    const res = await DELETE(new NextRequest('http://localhost/api/groups/g1'), {
      params: Promise.resolve({ id: 'c1', gid: 'g1' }),
    } as any);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true });
    expect(activityLogMock).toHaveBeenCalled();
  });
});
