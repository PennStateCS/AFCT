import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
  roster: { findFirst: vi.fn() },
}));

const authMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));

import { POST } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  // Default: caller not enrolled (denied); authorized tests grant a course role.
  prismaMock.roster.findFirst.mockResolvedValue(null);
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
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });

    const req = new NextRequest('http://localhost/api/courses/c1/bulk-enroll', {
      method: 'POST',
      body: JSON.stringify({ userIds: [] }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(400);
  });

  it('bulk enrolls users', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });

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
    expect(tx.roster.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ role: 'STUDENT' }) }),
    );
    expect(activityLogMock).toHaveBeenCalled();
  });

  it('sets STUDENT role for both updates and creates', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });

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
      expect.objectContaining({ data: { role: 'STUDENT' } }),
    );
    expect(tx.roster.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { role: 'STUDENT' } }),
    );
    expect(tx.roster.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ role: 'STUDENT' }) }),
    );
    expect(tx.roster.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ role: 'STUDENT' }) }),
    );
  });

  it('returns 500 when enrollment transaction fails', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });
    prismaMock.$transaction.mockRejectedValue(new Error('tx failed'));

    const req = new NextRequest('http://localhost/api/courses/c1/bulk-enroll', {
      method: 'POST',
      body: JSON.stringify({ userIds: ['u1'] }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'c1' }) });
    expect(res.status).toBe(500);
  });
});
