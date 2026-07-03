import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  user: { findMany: vi.fn() },
  activityLog: { findMany: vi.fn() },
}));

const authMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));

import { GET } from './route';

const makeRequest = () => new Request('http://localhost/api/logging');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/logging', () => {
  it('returns 403 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);

    const res = await GET(makeRequest());

    expect(res.status).toBe(403);
  });

  it('returns 403 when the user is not admin or faculty', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });

    const res = await GET(makeRequest());

    expect(res.status).toBe(403);
  });

  it('returns logs with userId resolved to the user full name', async () => {
    authMock.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
    prismaMock.user.findMany.mockResolvedValue([
      { id: 'u1', firstName: 'Ada', lastName: 'Lovelace' },
    ]);
    prismaMock.activityLog.findMany.mockResolvedValue([
      { id: 'log1', userId: 'u1', action: 'A', timestamp: new Date('2025-01-02T00:00:00.000Z') },
      { id: 'log2', userId: null, action: 'B', timestamp: new Date('2025-01-01T00:00:00.000Z') },
    ]);

    const res = await GET(makeRequest());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body[0].userId).toBe('Ada Lovelace');
    // Unknown / null author ids are left untouched.
    expect(body[1].userId).toBeNull();
  });

  it('leaves the raw id when the author is not found in the lookup', async () => {
    authMock.mockResolvedValue({ user: { id: 'admin-1', role: 'FACULTY' } });
    prismaMock.user.findMany.mockResolvedValue([]);
    prismaMock.activityLog.findMany.mockResolvedValue([
      { id: 'log1', userId: 'ghost', action: 'A', timestamp: new Date() },
    ]);

    const res = await GET(makeRequest());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body[0].userId).toBe('ghost');
  });

  it('falls back to email when the user has no name', async () => {
    authMock.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
    prismaMock.activityLog.findMany.mockResolvedValue([
      { id: 'log1', userId: 'u1', action: 'A', timestamp: new Date() },
    ]);
    prismaMock.user.findMany.mockResolvedValue([
      { id: 'u1', firstName: null, lastName: null, email: 'nameless@x.edu' },
    ]);

    const res = await GET(makeRequest());

    const body = await res.json();
    expect(body[0].userId).toBe('nameless@x.edu');
  });

  it('bounds the query to a default limit and honors ?limit=, clamping to the max', async () => {
    authMock.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
    prismaMock.activityLog.findMany.mockResolvedValue([]);

    await GET(new Request('http://localhost/api/logging'));
    expect(prismaMock.activityLog.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ take: 1000 }),
    );

    await GET(new Request('http://localhost/api/logging?limit=50'));
    expect(prismaMock.activityLog.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ take: 50 }),
    );

    await GET(new Request('http://localhost/api/logging?limit=999999'));
    expect(prismaMock.activityLog.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ take: 5000 }),
    );
  });

  it('returns 500 when the query fails', async () => {
    authMock.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
    prismaMock.activityLog.findMany.mockRejectedValue(new Error('db down'));

    const res = await GET(makeRequest());

    expect(res.status).toBe(500);
  });
});
