import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const prismaMock = vi.hoisted(() => ({
  studentGroup: { findFirst: vi.fn(), create: vi.fn() },
  course: { findUnique: vi.fn() },
  roster: { findFirst: vi.fn() },
}));
const authMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());
const serviceMock = vi.hoisted(() => ({ findGroupSet: vi.fn(), assertGroupSetUnlocked: vi.fn() }));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));
vi.mock('@/lib/group-set-service', () => serviceMock);

import { POST } from './route';

const ctx = { params: { id: 'c1', setId: 'gs1' } } as never;
const post = (body: unknown) =>
  POST(
    new NextRequest('http://localhost/api/courses/c1/group-sets/gs1/groups', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    ctx,
  );

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: 'staff', role: 'FACULTY' } });
  prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });
  prismaMock.course.findUnique.mockResolvedValue({ isArchived: false });
  serviceMock.findGroupSet.mockResolvedValue({ id: 'gs1', courseId: 'c1' });
});

describe('POST create group in a set', () => {
  it('409 on a duplicate group name within the set (case-insensitive)', async () => {
    prismaMock.studentGroup.findFirst.mockResolvedValue({ id: 'g1' });
    const res = await post({ name: ' group 1 ' });
    expect(res.status).toBe(409);
    expect(prismaMock.studentGroup.create).not.toHaveBeenCalled();
  });

  it('creates the group when the name is free in this set', async () => {
    prismaMock.studentGroup.findFirst.mockResolvedValue(null);
    prismaMock.studentGroup.create.mockResolvedValue({ id: 'g9', name: 'Group 1' });
    const res = await post({ name: 'Group 1' });
    expect(res.status).toBe(201);
    // The uniqueness check is scoped to this set, so the same name is free in
    // other sets (that scoping is exactly what the where-clause encodes).
    expect(prismaMock.studentGroup.findFirst.mock.calls[0]![0].where.groupSetId).toBe('gs1');
    expect(activityLogMock).toHaveBeenCalled();
  });

  it('404 when the set is not in this course', async () => {
    serviceMock.findGroupSet.mockResolvedValue(null);
    const res = await post({ name: 'Group 1' });
    expect(res.status).toBe(404);
  });
});
