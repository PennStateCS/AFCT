import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  activityLog: { findMany: vi.fn() },
}));
const authMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));

import { POST } from './route';

const post = (body: unknown, raw = false) =>
  new Request('http://localhost/api/logs/getData', {
    method: 'POST',
    body: raw ? (body as string) : JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/logs/getData', () => {
  it('returns 403 when not authorized', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });
    const res = await POST(post({ cols: ['id'], begTime: '', endTime: '' }));
    expect(res.status).toBe(403);
  });

  it('returns 400 for invalid JSON', async () => {
    authMock.mockResolvedValue({ user: { id: 'a1', role: 'ADMIN' } });
    const res = await POST(post('not-json', true));
    expect(res.status).toBe(400);
  });

  it('returns 400 when the schema rejects the body (no fields chosen)', async () => {
    authMock.mockResolvedValue({ user: { id: 'a1', role: 'ADMIN' } });
    const res = await POST(post({ cols: [], begTime: '', endTime: '' }));
    expect(res.status).toBe(400);
    expect(prismaMock.activityLog.findMany).not.toHaveBeenCalled();
  });

  it('returns 400 when no requested field is exportable', async () => {
    authMock.mockResolvedValue({ user: { id: 'a1', role: 'ADMIN' } });
    const res = await POST(post({ cols: ['evil', '__proto__'], begTime: '', endTime: '' }));
    expect(res.status).toBe(400);
    expect(prismaMock.activityLog.findMany).not.toHaveBeenCalled();
  });

  it('selects only exportable columns and applies the time range', async () => {
    authMock.mockResolvedValue({ user: { id: 'a1', role: 'ADMIN' } });
    prismaMock.activityLog.findMany.mockResolvedValue([{ id: 'log1', action: 'A' }]);

    const res = await POST(
      post({
        cols: ['id', 'action', 'notARealField'],
        begTime: '2025-01-01T00:00',
        endTime: '2025-12-31T23:59',
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ id: 'log1', action: 'A' }]);

    const call = prismaMock.activityLog.findMany.mock.calls[0][0];
    // Injection guard: unknown field is dropped from the select.
    expect(call.select).toEqual({ id: true, action: true });
    expect(call.where.timestamp.gte).toBeInstanceOf(Date);
    expect(call.where.timestamp.lte).toBeInstanceOf(Date);
    expect(call.take).toBe(100_000);
  });

  it('omits the time filter when the bounds are unparseable', async () => {
    authMock.mockResolvedValue({ user: { id: 'a1', role: 'ADMIN' } });
    prismaMock.activityLog.findMany.mockResolvedValue([]);

    await POST(post({ cols: ['id'], begTime: 'nonsense', endTime: 'nonsense' }));

    const call = prismaMock.activityLog.findMany.mock.calls[0][0];
    expect(call.where).toEqual({});
  });

  it('returns 500 when the query fails', async () => {
    authMock.mockResolvedValue({ user: { id: 'a1', role: 'ADMIN' } });
    prismaMock.activityLog.findMany.mockRejectedValue(new Error('db down'));

    const res = await POST(post({ cols: ['id'], begTime: '', endTime: '' }));
    expect(res.status).toBe(500);
  });
});
