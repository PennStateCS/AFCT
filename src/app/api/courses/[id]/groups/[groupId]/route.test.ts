import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const prismaMock = vi.hoisted(() => ({
  group: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
  roster: { findFirst: vi.fn() },
}));

const authMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));

import { OPTIONS, PATCH, DELETE } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.roster.findFirst.mockResolvedValue(null);
});

describe('OPTIONS /api/courses/[id]/groups/[groupId]', () => {
  it('returns 204 for preflight', async () => {
    const res = await OPTIONS();
    expect(res.status).toBe(204);
  });
});

describe('PATCH /api/courses/[id]/groups/[groupId]', () => {
  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);

    const res = await PATCH(
      new NextRequest('http://localhost/api/courses/c1/groups/g1', {
        method: 'PATCH',
        body: JSON.stringify({ name: 'New' }),
      }),
      { params: { id: 'c1', groupId: 'g1' } } as any,
    );
    expect(res.status).toBe(401);
  });

  it('returns 403 when role is not allowed', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });

    const res = await PATCH(
      new NextRequest('http://localhost/api/courses/c1/groups/g1', {
        method: 'PATCH',
        body: JSON.stringify({ name: 'New' }),
      }),
      { params: { id: 'c1', groupId: 'g1' } } as any,
    );
    expect(res.status).toBe(403);
  });

  it('returns 400 when missing params', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });

    const res = await PATCH(new NextRequest('http://localhost/api/courses//groups//'), {
      params: { id: '', groupId: '' },
    } as any);
    expect(res.status).toBe(400);
  });

  it('returns 422 when name missing', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });

    const res = await PATCH(
      new NextRequest('http://localhost/api/courses/c1/groups/g1', {
        method: 'PATCH',
        body: JSON.stringify({}),
      }),
      { params: { id: 'c1', groupId: 'g1' } } as any,
    );
    expect(res.status).toBe(422);
  });

  it('updates group and logs', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });
    prismaMock.group.findUnique.mockResolvedValue({ id: 'g1', courseId: 'c1' });
    prismaMock.group.findUnique.mockResolvedValueOnce({ id: 'g1', courseId: 'c1' });
    prismaMock.group.findUnique.mockResolvedValueOnce(null);
    prismaMock.group.update.mockResolvedValue({ id: 'g1', name: 'New' });

    const res = await PATCH(
      new NextRequest('http://localhost/api/courses/c1/groups/g1', {
        method: 'PATCH',
        body: JSON.stringify({ name: 'New' }),
      }),
      { params: { id: 'c1', groupId: 'g1' } } as any,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ id: 'g1', name: 'New' });
    expect(activityLogMock).toHaveBeenCalled();
  });

  it('returns 404 when group does not belong to course', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });
    prismaMock.group.findUnique.mockResolvedValue({ id: 'g1', courseId: 'other' });

    const res = await PATCH(
      new NextRequest('http://localhost/api/courses/c1/groups/g1', {
        method: 'PATCH',
        body: JSON.stringify({ name: 'New' }),
      }),
      { params: { id: 'c1', groupId: 'g1' } } as any,
    );
    expect(res.status).toBe(404);
  });

  it('returns 409 when group name already exists in course', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });
    prismaMock.group.findUnique.mockResolvedValueOnce({ id: 'g1', courseId: 'c1' });
    prismaMock.group.findUnique.mockResolvedValueOnce({ id: 'g2', courseId: 'c1', name: 'New' });

    const res = await PATCH(
      new NextRequest('http://localhost/api/courses/c1/groups/g1', {
        method: 'PATCH',
        body: JSON.stringify({ name: 'New' }),
      }),
      { params: { id: 'c1', groupId: 'g1' } } as any,
    );
    expect(res.status).toBe(409);
  });

  it('returns 500 when update fails unexpectedly', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });
    prismaMock.group.findUnique.mockResolvedValueOnce({ id: 'g1', courseId: 'c1' });
    prismaMock.group.findUnique.mockResolvedValueOnce(null);
    prismaMock.group.update.mockRejectedValue(new Error('update failed'));

    const res = await PATCH(
      new NextRequest('http://localhost/api/courses/c1/groups/g1', {
        method: 'PATCH',
        body: JSON.stringify({ name: 'New' }),
      }),
      { params: { id: 'c1', groupId: 'g1' } } as any,
    );
    expect(res.status).toBe(500);
  });
});

describe('DELETE /api/courses/[id]/groups/[groupId]', () => {
  it('returns 400 when missing params', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });

    const res = await DELETE(new NextRequest('http://localhost/api/courses//groups//'), {
      params: { id: '', groupId: '' },
    } as any);
    expect(res.status).toBe(400);
  });

  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);

    const res = await DELETE(new NextRequest('http://localhost/api/courses/c1/groups/g1'), {
      params: { id: 'c1', groupId: 'g1' },
    } as any);
    expect(res.status).toBe(401);
  });

  it('returns 403 for forbidden role', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });

    const res = await DELETE(new NextRequest('http://localhost/api/courses/c1/groups/g1'), {
      params: { id: 'c1', groupId: 'g1' },
    } as any);
    expect(res.status).toBe(403);
  });

  it('deletes group and logs', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });
    prismaMock.group.findUnique.mockResolvedValue({ id: 'g1', courseId: 'c1' });
    prismaMock.group.delete.mockResolvedValue({ id: 'g1' });

    const res = await DELETE(new NextRequest('http://localhost/api/courses/c1/groups/g1'), {
      params: { id: 'c1', groupId: 'g1' },
    } as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true });
    expect(activityLogMock).toHaveBeenCalled();
  });

  it('returns 404 when group does not belong to course', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });
    prismaMock.group.findUnique.mockResolvedValue({ id: 'g1', courseId: 'other' });

    const res = await DELETE(new NextRequest('http://localhost/api/courses/c1/groups/g1'), {
      params: { id: 'c1', groupId: 'g1' },
    } as any);
    expect(res.status).toBe(404);
  });

  it('returns 500 when delete throws', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });
    prismaMock.group.findUnique.mockResolvedValue({ id: 'g1', courseId: 'c1' });
    prismaMock.group.delete.mockRejectedValue(new Error('delete failed'));

    const res = await DELETE(new NextRequest('http://localhost/api/courses/c1/groups/g1'), {
      params: { id: 'c1', groupId: 'g1' },
    } as any);
    expect(res.status).toBe(500);
  });
});
