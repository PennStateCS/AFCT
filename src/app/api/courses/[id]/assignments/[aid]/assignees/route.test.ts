import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const prismaMock = vi.hoisted(() => {
  const mock = {
    course: { findUnique: vi.fn() },
    assignment: { findFirst: vi.fn(), update: vi.fn() },
    assignmentAssignee: { findMany: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn() },
    assignmentOverride: { deleteMany: vi.fn() },
    studentGroup: { findMany: vi.fn() },
    roster: { findFirst: vi.fn(), findMany: vi.fn() },
    $transaction: vi.fn(),
  };
  mock.$transaction.mockImplementation(async (cb: (tx: typeof mock) => unknown) => cb(mock));
  return mock;
});

const authMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));

import { GET, PUT } from './route';

const ctx = { params: Promise.resolve({ id: 'c1', aid: 'a1' }) };
const put = (body: unknown) =>
  PUT(
    new NextRequest('http://localhost/api/courses/c1/assignments/a1/assignees', {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
    ctx,
  );

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: 'staff-1', role: 'FACULTY' } });
  prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });
  prismaMock.course.findUnique.mockResolvedValue({ isArchived: false });
  prismaMock.assignment.findFirst.mockResolvedValue({ id: 'a1', groupSetId: null });
  prismaMock.assignment.update.mockResolvedValue({ id: 'a1' });
  prismaMock.$transaction.mockImplementation(async (cb: (tx: typeof prismaMock) => unknown) =>
    cb(prismaMock),
  );
});

describe('GET assignees', () => {
  it('lists the assignment assignees', async () => {
    prismaMock.assignmentAssignee.findMany.mockResolvedValue([{ id: 'x1', userId: 's1' }]);
    const res = await GET(new NextRequest('http://localhost/x'), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ id: 'x1', userId: 's1' }]);
  });
});

describe('PUT assignees', () => {
  it('clears the audience when assigned to everyone', async () => {
    const res = await put({ assignedToEveryone: true });

    expect(res.status).toBe(200);
    expect(prismaMock.assignmentAssignee.deleteMany).toHaveBeenCalledWith({
      where: { assignmentId: 'a1' },
    });
    expect(prismaMock.assignmentAssignee.createMany).not.toHaveBeenCalled();
    expect(prismaMock.assignment.update).toHaveBeenCalledWith({
      where: { id: 'a1' },
      data: { assignedToEveryone: true },
    });
  });

  it('sets a specific-students audience and drops orphaned overrides', async () => {
    prismaMock.roster.findMany.mockResolvedValue([{ userId: 's1' }]);

    const res = await put({ assignedToEveryone: false, assignees: [{ userId: 's1' }] });

    expect(res.status).toBe(200);
    expect(prismaMock.assignmentAssignee.createMany).toHaveBeenCalledWith({
      data: [{ assignmentId: 'a1', targetType: 'STUDENT', userId: 's1' }],
    });
    expect(prismaMock.assignmentOverride.deleteMany).toHaveBeenCalledWith({
      where: { assignmentId: 'a1', userId: { notIn: ['s1'] } },
    });
  });

  it('rejects a non-enrolled student target', async () => {
    prismaMock.roster.findMany.mockResolvedValue([]); // s1 not found as a STUDENT

    const res = await put({ assignedToEveryone: false, assignees: [{ userId: 's1' }] });

    expect(res.status).toBe(400);
    expect(prismaMock.assignment.update).not.toHaveBeenCalled();
  });

  it('rejects a group target on an individual assignment', async () => {
    const res = await put({ assignedToEveryone: false, assignees: [{ groupId: 'g1' }] });

    expect(res.status).toBe(400);
    expect(prismaMock.assignment.update).not.toHaveBeenCalled();
  });

  it('sets a specific-groups audience on a group assignment', async () => {
    prismaMock.assignment.findFirst.mockResolvedValue({ id: 'a1', groupSetId: 'gs1' });
    prismaMock.studentGroup.findMany.mockResolvedValue([{ id: 'g1' }]);

    const res = await put({ assignedToEveryone: false, assignees: [{ groupId: 'g1' }] });

    expect(res.status).toBe(200);
    expect(prismaMock.assignmentAssignee.createMany).toHaveBeenCalledWith({
      data: [{ assignmentId: 'a1', targetType: 'GROUP', groupId: 'g1' }],
    });
  });

  it('rejects an empty specific audience', async () => {
    const res = await put({ assignedToEveryone: false, assignees: [] });
    expect(res.status).toBe(400);
  });

  it('returns 404 when the assignment is not in the course', async () => {
    prismaMock.assignment.findFirst.mockResolvedValue(null);
    const res = await put({ assignedToEveryone: true });
    expect(res.status).toBe(404);
  });
});
