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

import { GET, DELETE } from './route';

beforeEach(() => vi.clearAllMocks());

describe('GET /api/courses/[id]/[aid]/group-problems', () => {
  it('returns 403 when not authenticated', async () => {
    authMock.mockResolvedValue(null);
    const res = await GET(new NextRequest('http://localhost/api/courses/c1/a1/group-problems'), { params: Promise.resolve({ id: 'c1', aid: 'a1' }) } as any);
    expect(res.status).toBe(403);
  });

  it('returns groups + mappings and logs the view', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });
    prismaMock.group.findMany.mockResolvedValue([{ id: 'g1', name: 'G1' }]);
    prismaMock.groupAssignmentProblem.findMany.mockResolvedValue([{ assignmentId: 'a1', problemId: 'p1', groupId: 'g1' }]);

    const res = await GET(new NextRequest('http://localhost/api/courses/c1/a1/group-problems'), { params: Promise.resolve({ id: 'c1', aid: 'a1' }) } as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.groups)).toBe(true);
    expect(body.groups[0].problemIds).toEqual(['p1']);
    expect(activityLogMock).toHaveBeenCalled();
    const logArgs = activityLogMock.mock.calls[0][2];
    expect(logArgs.action).toBe('VIEW_GROUP_PROBLEMS');
    expect(logArgs.assignmentId).toBe('a1');
  });
});

describe('DELETE /api/courses/[id]/[aid]/group-problems', () => {
  it('returns 403 when unauthorized role', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });
    const req = new NextRequest('http://localhost/api/courses/c1/a1/group-problems', { method: 'DELETE', body: JSON.stringify({ problemIds: ['p1'], groupId: 'g1' }) });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'c1', aid: 'a1' }) } as any);
    expect(res.status).toBe(403);
  });

  it('deletes mappings and logs the removal', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    prismaMock.group.findUnique.mockResolvedValue({ id: 'g1', courseId: 'c1' });
    prismaMock.groupAssignmentProblem.deleteMany.mockResolvedValue({ count: 1 });

    const req = new NextRequest('http://localhost/api/courses/c1/a1/group-problems', { method: 'DELETE', body: JSON.stringify({ problemIds: ['p1'], groupId: 'g1' }) });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'c1', aid: 'a1' }) } as any);

    expect(res.status).toBe(200);
    expect(prismaMock.groupAssignmentProblem.deleteMany).toHaveBeenCalled();
    expect(activityLogMock).toHaveBeenCalled();
    const logArgs = activityLogMock.mock.calls[0][2];
    expect(logArgs.action).toBe('REMOVE_GROUP_PROBLEMS');
    expect(logArgs.assignmentId).toBe('a1');
    expect(logArgs.metadata.problemIds).toEqual(['p1']);
  });
});
