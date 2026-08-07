import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { routeCtx } from '@/test/route';

const authMock = vi.hoisted(() => vi.fn());
const getPageMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/autograder-submissions', () => ({ getAutograderSubmissionsPage: getPageMock }));

import { POST } from './route';

const makeRequest = (body: unknown) =>
  new NextRequest('http://localhost/api/admin/submissions', {
    method: 'POST',
    body: JSON.stringify(body),
  });

const admin = { user: { id: 'admin-1', isAdmin: true } };

beforeEach(() => {
  vi.clearAllMocks();
  getPageMock.mockResolvedValue({ rows: [], total: 0 });
});

describe('POST /api/admin/submissions', () => {
  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);

    const res = await POST(makeRequest({}), routeCtx());

    expect(res.status).toBe(401);
    expect(getPageMock).not.toHaveBeenCalled();
  });

  it('returns 403 when the user is not admin', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', isAdmin: false } });

    const res = await POST(makeRequest({}), routeCtx());

    expect(res.status).toBe(403);
    expect(getPageMock).not.toHaveBeenCalled();
  });

  it('returns the page envelope', async () => {
    authMock.mockResolvedValue(admin);
    getPageMock.mockResolvedValue({ rows: [{ id: 's1' }], total: 23 });

    const res = await POST(makeRequest({ page: 2, pageSize: 5 }), routeCtx());

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      rows: [{ id: 's1' }],
      total: 23,
      page: 2,
      pageSize: 5,
      totalPages: 5,
    });
  });

  it('turns page and pageSize into skip and take', async () => {
    authMock.mockResolvedValue(admin);

    await POST(makeRequest({ page: 3, pageSize: 20 }), routeCtx());

    expect(getPageMock).toHaveBeenCalledWith(expect.objectContaining({ skip: 40, take: 20 }));
  });

  it('defaults to the first page when pagination is omitted', async () => {
    authMock.mockResolvedValue(admin);

    await POST(makeRequest({}), routeCtx());

    expect(getPageMock).toHaveBeenCalledWith(expect.objectContaining({ skip: 0, take: 10 }));
  });

  it('clamps an oversized pageSize rather than rejecting it', async () => {
    authMock.mockResolvedValue(admin);

    const res = await POST(makeRequest({ pageSize: 99999 }), routeCtx());

    expect(res.status).toBe(200);
    expect(getPageMock).toHaveBeenCalledWith(expect.objectContaining({ take: 100 }));
  });

  it('passes scope, search, filters and sort through to the query', async () => {
    authMock.mockResolvedValue(admin);

    await POST(
      makeRequest({
        courseIds: ['c1'],
        assignmentIds: ['a1'],
        problemIds: ['p1'],
        q: 'dent',
        field: 'student',
        timing: ['late'],
        status: ['failed', 'incorrect'],
        sortBy: 'student',
        sortDir: 'asc',
      }),
      routeCtx(),
    );

    expect(getPageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        courseIds: ['c1'],
        assignmentIds: ['a1'],
        problemIds: ['p1'],
        q: 'dent',
        field: 'student',
        timing: ['late'],
        status: ['failed', 'incorrect'],
        sortBy: 'student',
        sortDir: 'asc',
      }),
    );
  });

  it('treats an empty body as an unfiltered request rather than a 400', async () => {
    authMock.mockResolvedValue(admin);

    const res = await POST(makeRequest({}), routeCtx());

    expect(res.status).toBe(200);
    expect(getPageMock).toHaveBeenCalledWith(
      expect.objectContaining({ courseIds: [], assignmentIds: [], problemIds: [] }),
    );
  });

  it('rejects an unknown filter token', async () => {
    authMock.mockResolvedValue(admin);

    const res = await POST(makeRequest({ status: ['banana'] }), routeCtx());

    expect(res.status).toBe(400);
    expect(getPageMock).not.toHaveBeenCalled();
  });

  it('returns 500 when the query fails', async () => {
    authMock.mockResolvedValue(admin);
    getPageMock.mockRejectedValue(new Error('db down'));

    const res = await POST(makeRequest({}), routeCtx());

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: 'Failed to fetch submissions' });
  });
});
