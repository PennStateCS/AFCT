import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const prismaMock = vi.hoisted(() => ({
  group: { findMany: vi.fn(), findUnique: vi.fn() },
  groupAssignmentProblem: { findMany: vi.fn(), deleteMany: vi.fn() },
}));

const authMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));

import { GET, POST, DELETE } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  // clearAllMocks doesn't reset implementations, so drop any leaked mockRejectedValue.
  activityLogMock.mockReset();
});

describe('GET /api/courses/[id]/[aid]/group-problems', () => {
  it('returns 403 when not authenticated', async () => {
    authMock.mockResolvedValue(null);
    const res = await GET(new NextRequest('http://localhost/api/courses/c1/a1/group-problems'), {
      params: Promise.resolve({ id: 'c1', aid: 'a1' }),
    } as any);
    expect(res.status).toBe(403);
  });

  it('returns groups + mappings and logs the view', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });
    prismaMock.group.findMany.mockResolvedValue([{ id: 'g1', name: 'G1' }]);
    prismaMock.groupAssignmentProblem.findMany.mockResolvedValue([
      { assignmentId: 'a1', problemId: 'p1', groupId: 'g1' },
    ]);

    const res = await GET(new NextRequest('http://localhost/api/courses/c1/a1/group-problems'), {
      params: Promise.resolve({ id: 'c1', aid: 'a1' }),
    } as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.groups)).toBe(true);
    expect(body.groups[0].problemIds).toEqual(['p1']);
    expect(activityLogMock).toHaveBeenCalled();
    const logArgs = activityLogMock.mock.calls[0][2];
    expect(logArgs.action).toBe('VIEW_GROUP_PROBLEMS');
    expect(logArgs.assignmentId).toBe('a1');
  });

  it('supports POST { action: "list" } to return groups+mapping (no-signal client)', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });
    prismaMock.group.findMany.mockResolvedValue([{ id: 'g1', name: 'G1' }]);
    prismaMock.groupAssignmentProblem.findMany.mockResolvedValue([
      { assignmentId: 'a1', problemId: 'p1', groupId: 'g1' },
    ]);

    const req = new NextRequest('http://localhost/api/courses/c1/a1/group-problems', {
      method: 'POST',
      body: JSON.stringify({ action: 'list' }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'c1', aid: 'a1' }) } as any);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.groups)).toBe(true);
    expect(body.groups[0].problemIds).toEqual(['p1']);
    expect(activityLogMock).toHaveBeenCalled();
  });

  it('returns 403 for POST when unauthenticated', async () => {
    authMock.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/courses/c1/a1/group-problems', {
      method: 'POST',
      body: JSON.stringify({ action: 'list' }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'c1', aid: 'a1' }) } as any);

    expect(res.status).toBe(403);
  });

  it('returns 400 for unsupported POST action', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });

    const req = new NextRequest('http://localhost/api/courses/c1/a1/group-problems', {
      method: 'POST',
      body: JSON.stringify({ action: 'noop' }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'c1', aid: 'a1' }) } as any);

    expect(res.status).toBe(400);
  });

  it('still returns 200 when activity logging fails in GET', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });
    prismaMock.group.findMany.mockResolvedValue([{ id: 'g1', name: 'G1' }]);
    prismaMock.groupAssignmentProblem.findMany.mockResolvedValue([]);
    activityLogMock.mockRejectedValue(new Error('log failed'));

    const res = await GET(new NextRequest('http://localhost/api/courses/c1/a1/group-problems'), {
      params: Promise.resolve({ id: 'c1', aid: 'a1' }),
    } as any);

    expect(res.status).toBe(200);
  });
});

describe('DELETE /api/courses/[id]/[aid]/group-problems', () => {
  it('returns 403 when unauthorized role', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });
    const req = new NextRequest('http://localhost/api/courses/c1/a1/group-problems', {
      method: 'DELETE',
      body: JSON.stringify({ problemIds: ['p1'], groupId: 'g1' }),
    });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'c1', aid: 'a1' }) } as any);
    expect(res.status).toBe(403);
  });

  it('deletes mappings and logs the removal', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    prismaMock.group.findUnique.mockResolvedValue({ id: 'g1', courseId: 'c1' });
    prismaMock.groupAssignmentProblem.deleteMany.mockResolvedValue({ count: 1 });

    const req = new NextRequest('http://localhost/api/courses/c1/a1/group-problems', {
      method: 'DELETE',
      body: JSON.stringify({ problemIds: ['p1'], groupId: 'g1' }),
    });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'c1', aid: 'a1' }) } as any);

    expect(res.status).toBe(200);
    expect(prismaMock.groupAssignmentProblem.deleteMany).toHaveBeenCalled();
    expect(activityLogMock).toHaveBeenCalled();
    const logArgs = activityLogMock.mock.calls[0][2];
    expect(logArgs.action).toBe('REMOVE_GROUP_PROBLEMS');
    expect(logArgs.assignmentId).toBe('a1');
    expect(logArgs.metadata.problemIds).toEqual(['p1']);
  });

  it('returns 400 for empty DELETE body', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });

    const req = new NextRequest('http://localhost/api/courses/c1/a1/group-problems', {
      method: 'DELETE',
      body: '',
    });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'c1', aid: 'a1' }) } as any);

    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid JSON in DELETE', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });

    const req = new NextRequest('http://localhost/api/courses/c1/a1/group-problems', {
      method: 'DELETE',
      body: '{bad',
    });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'c1', aid: 'a1' }) } as any);

    expect(res.status).toBe(400);
  });

  it('returns 400 when problemIds are missing', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });

    const req = new NextRequest('http://localhost/api/courses/c1/a1/group-problems', {
      method: 'DELETE',
      body: JSON.stringify({ groupId: 'g1' }),
    });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'c1', aid: 'a1' }) } as any);

    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid group in DELETE', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    prismaMock.group.findUnique.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/courses/c1/a1/group-problems', {
      method: 'DELETE',
      body: JSON.stringify({ groupId: 'g1', problemIds: ['p1'] }),
    });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'c1', aid: 'a1' }) } as any);

    expect(res.status).toBe(400);
  });

  it('returns 400 when groupId is omitted in DELETE', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });

    const req = new NextRequest('http://localhost/api/courses/c1/a1/group-problems', {
      method: 'DELETE',
      body: JSON.stringify({ problemIds: ['p1'] }),
    });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'c1', aid: 'a1' }) } as any);

    expect(res.status).toBe(400);
  });

  it('supports groupId=ALL branch in DELETE', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });

    const req = new NextRequest('http://localhost/api/courses/c1/a1/group-problems', {
      method: 'DELETE',
      body: JSON.stringify({ groupId: 'ALL', problemIds: ['p1', 'p2'] }),
    });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'c1', aid: 'a1' }) } as any);

    expect(res.status).toBe(200);
    expect(prismaMock.groupAssignmentProblem.deleteMany).toHaveBeenCalledWith({
      where: { assignmentId: 'a1', problemId: { in: ['p1', 'p2'] } },
    });
  });

  it('still succeeds when removal activity logging fails', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    prismaMock.group.findUnique.mockResolvedValue({ id: 'g1', courseId: 'c1' });
    activityLogMock.mockRejectedValue(new Error('log failed'));

    const req = new NextRequest('http://localhost/api/courses/c1/a1/group-problems', {
      method: 'DELETE',
      body: JSON.stringify({ groupId: 'g1', problemIds: ['p1'] }),
    });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'c1', aid: 'a1' }) } as any);

    expect(res.status).toBe(200);
  });
});
