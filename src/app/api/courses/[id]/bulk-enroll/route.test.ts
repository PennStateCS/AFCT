import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const prismaMock = vi.hoisted(() => ({
  user: { findMany: vi.fn() },
  $transaction: vi.fn(),
}));

const authMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));

import { POST } from './route';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/courses/[id]/bulk-enroll', () => {
  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/courses/c1/bulk-enroll', {
      method: 'POST',
      body: JSON.stringify({ userIds: ['u1'] }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(401);
  });

  it('returns 403 when forbidden', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });

    const req = new NextRequest('http://localhost/api/courses/c1/bulk-enroll', {
      method: 'POST',
      body: JSON.stringify({ userIds: ['u1'] }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(403);
  });

  it('returns 400 when no users provided', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });

    const req = new NextRequest('http://localhost/api/courses/c1/bulk-enroll', {
      method: 'POST',
      body: JSON.stringify({ userIds: [] }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(400);
  });

  it('bulk enrolls users', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    prismaMock.user.findMany.mockResolvedValue([{ id: 'u1', role: 'ADMIN' }]);

    const tx = {
      roster: {
        findFirst: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
        create: vi.fn(),
      },
    };
    prismaMock.$transaction.mockImplementation(async (cb: (client: typeof tx) => unknown) =>
      cb(tx),
    );

    const req = new NextRequest('http://localhost/api/courses/c1/bulk-enroll', {
      method: 'POST',
      body: JSON.stringify({ userIds: ['u1'] }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(200);
    expect(tx.roster.create).toHaveBeenCalled();
    expect(activityLogMock).toHaveBeenCalled();
  });

  it('maps roles and updates existing roster entries', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    prismaMock.user.findMany.mockResolvedValue([
      { id: 'u1', role: 'ADMIN' },
      { id: 'u2', role: 'FACULTY' },
      { id: 'u3', role: 'TA' },
      { id: 'u4', role: null },
    ]);

    const tx = {
      roster: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce({ id: 'r1' })
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ id: 'r3' })
          .mockResolvedValueOnce(null),
        update: vi.fn(),
        create: vi.fn(),
      },
    };
    prismaMock.$transaction.mockImplementation(async (cb: (client: typeof tx) => unknown) =>
      cb(tx),
    );

    const req = new NextRequest('http://localhost/api/courses/c1/bulk-enroll', {
      method: 'POST',
      body: JSON.stringify({ userIds: ['u1', 'u2', 'u3', 'u4'] }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(200);
    expect(tx.roster.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { role: 'INSTRUCTOR' } }),
    );
    expect(tx.roster.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { role: 'TA' } }),
    );
    expect(tx.roster.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ role: 'FACULTY' }) }),
    );
    expect(tx.roster.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ role: 'STUDENT' }) }),
    );
  });

  it('returns 500 when enrollment transaction fails', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    prismaMock.user.findMany.mockResolvedValue([{ id: 'u1', role: 'FACULTY' }]);
    prismaMock.$transaction.mockRejectedValue(new Error('tx failed'));

    const req = new NextRequest('http://localhost/api/courses/c1/bulk-enroll', {
      method: 'POST',
      body: JSON.stringify({ userIds: ['u1'] }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'c1' }) });
    expect(res.status).toBe(500);
  });
});
