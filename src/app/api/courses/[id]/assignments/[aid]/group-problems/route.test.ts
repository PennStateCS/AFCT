import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const prismaMock = vi.hoisted(() => ({
  group: { findMany: vi.fn(), findUnique: vi.fn() },
  groupAssignmentProblem: { findMany: vi.fn(), deleteMany: vi.fn() },
  course: { findUnique: vi.fn() },
  roster: { findFirst: vi.fn() },
}));

const authMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));

import { GET, DELETE } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.roster.findFirst.mockResolvedValue(null);
  prismaMock.course.findUnique.mockResolvedValue({ isArchived: false });
  // clearAllMocks doesn't reset implementations, so drop any leaked mockRejectedValue.
  activityLogMock.mockReset();
});

describe('GET /api/courses/[id]/[aid]/group-problems', () => {
  it('returns 401 when not authenticated', async () => {
    authMock.mockResolvedValue(null);
    const res = await GET(
      new NextRequest('http://localhost/api/courses/c1/assignments/a1/group-problems'),
      {
        params: Promise.resolve({ id: 'c1', aid: 'a1' }),
      } as any,
    );
    expect(res.status).toBe(401);
  });

  it('denies an enrolled STUDENT (staff-only)', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'STUDENT' });

    const res = await GET(
      new NextRequest('http://localhost/api/courses/c1/assignments/a1/group-problems'),
      { params: Promise.resolve({ id: 'c1', aid: 'a1' }) } as any,
    );
    expect(res.status).toBe(403);
  });

  it('returns groups + mappings and logs the view', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });
    prismaMock.group.findMany.mockResolvedValue([{ id: 'g1', name: 'G1' }]);
    prismaMock.groupAssignmentProblem.findMany.mockResolvedValue([
      { assignmentId: 'a1', problemId: 'p1', groupId: 'g1' },
    ]);

    const res = await GET(
      new NextRequest('http://localhost/api/courses/c1/assignments/a1/group-problems'),
      {
        params: Promise.resolve({ id: 'c1', aid: 'a1' }),
      } as any,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.groups)).toBe(true);
    expect(body.groups[0].problemIds).toEqual(['p1']);
    expect(activityLogMock).toHaveBeenCalled();
    const logArgs = activityLogMock.mock.calls[0][2];
    expect(logArgs.action).toBe('VIEW_GROUP_PROBLEMS');
    expect(logArgs.assignmentId).toBe('a1');
  });

  it('groups multiple problems mapped to the same group', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });
    prismaMock.group.findMany.mockResolvedValue([{ id: 'g1', name: 'G1' }]);
    // Two mappings for the same group exercises the "already-seen group" branch.
    prismaMock.groupAssignmentProblem.findMany.mockResolvedValue([
      { assignmentId: 'a1', problemId: 'p1', groupId: 'g1' },
      { assignmentId: 'a1', problemId: 'p2', groupId: 'g1' },
    ]);

    const res = await GET(
      new NextRequest('http://localhost/api/courses/c1/assignments/a1/group-problems'),
      { params: Promise.resolve({ id: 'c1', aid: 'a1' }) } as any,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.groups[0].problemIds).toEqual(['p1', 'p2']);
  });

  it('returns 500 when fetching group problems throws', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });
    prismaMock.group.findMany.mockRejectedValueOnce(new Error('db down'));

    const res = await GET(
      new NextRequest('http://localhost/api/courses/c1/assignments/a1/group-problems'),
      { params: Promise.resolve({ id: 'c1', aid: 'a1' }) } as any,
    );

    expect(res.status).toBe(500);
    consoleSpy.mockRestore();
  });

  it('still returns 200 when activity logging fails in GET', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });
    prismaMock.group.findMany.mockResolvedValue([{ id: 'g1', name: 'G1' }]);
    prismaMock.groupAssignmentProblem.findMany.mockResolvedValue([]);
    activityLogMock.mockRejectedValue(new Error('log failed'));

    const res = await GET(
      new NextRequest('http://localhost/api/courses/c1/assignments/a1/group-problems'),
      {
        params: Promise.resolve({ id: 'c1', aid: 'a1' }),
      } as any,
    );

    expect(res.status).toBe(200);
  });
});

describe('DELETE /api/courses/[id]/[aid]/group-problems', () => {
  it('returns 403 when unauthorized role', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });
    const req = new NextRequest('http://localhost/api/courses/c1/assignments/a1/group-problems', {
      method: 'DELETE',
      body: JSON.stringify({ problemIds: ['p1'], groupId: 'g1' }),
    });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'c1', aid: 'a1' }) } as any);
    expect(res.status).toBe(403);
  });

  it('deletes mappings and logs the removal', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });
    prismaMock.group.findUnique.mockResolvedValue({ id: 'g1', courseId: 'c1' });
    prismaMock.groupAssignmentProblem.deleteMany.mockResolvedValue({ count: 1 });

    const req = new NextRequest('http://localhost/api/courses/c1/assignments/a1/group-problems', {
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

  it('returns 409 when the course is archived', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });
    prismaMock.course.findUnique.mockResolvedValue({ isArchived: true });

    const req = new NextRequest('http://localhost/api/courses/c1/assignments/a1/group-problems', {
      method: 'DELETE',
      body: JSON.stringify({ problemIds: ['p1'], groupId: 'g1' }),
    });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'c1', aid: 'a1' }) } as any);

    expect(res.status).toBe(409);
    expect(prismaMock.groupAssignmentProblem.deleteMany).not.toHaveBeenCalled();
  });

  it('returns 400 for empty DELETE body', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });

    const req = new NextRequest('http://localhost/api/courses/c1/assignments/a1/group-problems', {
      method: 'DELETE',
      body: '',
    });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'c1', aid: 'a1' }) } as any);

    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid JSON in DELETE', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });

    const req = new NextRequest('http://localhost/api/courses/c1/assignments/a1/group-problems', {
      method: 'DELETE',
      body: '{bad',
    });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'c1', aid: 'a1' }) } as any);

    expect(res.status).toBe(400);
  });

  it('returns 400 when problemIds are missing', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });

    const req = new NextRequest('http://localhost/api/courses/c1/assignments/a1/group-problems', {
      method: 'DELETE',
      body: JSON.stringify({ groupId: 'g1' }),
    });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'c1', aid: 'a1' }) } as any);

    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid group in DELETE', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });
    prismaMock.group.findUnique.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/courses/c1/assignments/a1/group-problems', {
      method: 'DELETE',
      body: JSON.stringify({ groupId: 'g1', problemIds: ['p1'] }),
    });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'c1', aid: 'a1' }) } as any);

    expect(res.status).toBe(400);
  });

  it('returns 400 when groupId is omitted in DELETE', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });

    const req = new NextRequest('http://localhost/api/courses/c1/assignments/a1/group-problems', {
      method: 'DELETE',
      body: JSON.stringify({ problemIds: ['p1'] }),
    });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'c1', aid: 'a1' }) } as any);

    expect(res.status).toBe(400);
  });

  it('supports groupId=ALL branch in DELETE', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });

    const req = new NextRequest('http://localhost/api/courses/c1/assignments/a1/group-problems', {
      method: 'DELETE',
      body: JSON.stringify({ groupId: 'ALL', problemIds: ['p1', 'p2'] }),
    });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'c1', aid: 'a1' }) } as any);

    expect(res.status).toBe(200);
    expect(prismaMock.groupAssignmentProblem.deleteMany).toHaveBeenCalledWith({
      where: { assignmentId: 'a1', problemId: { in: ['p1', 'p2'] } },
    });
  });

  it('returns 500 when deleting mappings throws', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });
    prismaMock.group.findUnique.mockResolvedValue({ id: 'g1', courseId: 'c1' });
    prismaMock.groupAssignmentProblem.deleteMany.mockRejectedValueOnce(new Error('db down'));

    const req = new NextRequest('http://localhost/api/courses/c1/assignments/a1/group-problems', {
      method: 'DELETE',
      body: JSON.stringify({ groupId: 'g1', problemIds: ['p1'] }),
    });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'c1', aid: 'a1' }) } as any);

    expect(res.status).toBe(500);
    consoleSpy.mockRestore();
  });

  it('still succeeds when removal activity logging fails', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });
    prismaMock.group.findUnique.mockResolvedValue({ id: 'g1', courseId: 'c1' });
    activityLogMock.mockRejectedValue(new Error('log failed'));

    const req = new NextRequest('http://localhost/api/courses/c1/assignments/a1/group-problems', {
      method: 'DELETE',
      body: JSON.stringify({ groupId: 'g1', problemIds: ['p1'] }),
    });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'c1', aid: 'a1' }) } as any);

    expect(res.status).toBe(200);
  });
});
