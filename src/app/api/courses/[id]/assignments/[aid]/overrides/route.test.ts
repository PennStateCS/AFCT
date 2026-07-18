import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const txMock = {
  assignmentOverride: { create: vi.fn() },
  assignment: { update: vi.fn() },
};
const prismaMock = vi.hoisted(() => ({
  course: { findUnique: vi.fn() },
  assignment: { findFirst: vi.fn(), update: vi.fn() },
  assignmentOverride: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
  roster: { findFirst: vi.fn(), findUnique: vi.fn() },
  studentGroup: { findFirst: vi.fn() },
  groupMembership: { findMany: vi.fn() },
  $transaction: vi.fn(),
}));

const authMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());
const resolveTzMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));
vi.mock('@/lib/course-timezone', () => ({ resolveCourseTimezone: resolveTzMock }));

import { GET, POST } from './route';

const BASE_ASSIGNMENT = {
  id: 'a1',
  unlockAt: null,
  dueDate: new Date('2026-01-10T23:59:00.000Z'),
  lateCutoff: null,
  allowLateSubmissions: false,
  assignedToEveryone: true,
  groupSetId: null as string | null,
};

const ctx = { params: Promise.resolve({ id: 'c1', aid: 'a1' }) };

const post = (body: unknown) =>
  POST(
    new NextRequest('http://localhost/api/courses/c1/assignments/a1/overrides', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    ctx,
  );

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: 'staff-1', role: 'FACULTY' } });
  prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' }); // course-auth wrapper
  prismaMock.course.findUnique.mockResolvedValue({ isArchived: false });
  prismaMock.assignment.findFirst.mockResolvedValue(BASE_ASSIGNMENT);
  prismaMock.assignmentOverride.findFirst.mockResolvedValue(null); // no double-target clash
  resolveTzMock.mockResolvedValue('UTC');
  txMock.assignmentOverride.create.mockReset();
  txMock.assignment.update.mockReset();
  prismaMock.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(txMock));
});

describe('POST /api/courses/[id]/assignments/[aid]/overrides', () => {
  it('creates a student override and logs it', async () => {
    prismaMock.roster.findUnique.mockResolvedValue({ role: 'STUDENT' });
    prismaMock.assignmentOverride.create.mockResolvedValue({
      id: 'o1',
      targetType: 'STUDENT',
      userId: 'stu-1',
      unlockAt: null,
      dueDate: new Date('2026-01-20T23:59:00.000Z'),
      lateCutoff: null,
      allowLateSubmissions: null,
    });

    const res = await post({ userId: 'stu-1', dueDate: '2026-01-20' });

    expect(res.status).toBe(201);
    expect(prismaMock.assignmentOverride.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ targetType: 'STUDENT', userId: 'stu-1', createdById: 'staff-1' }),
      }),
    );
    expect(activityLogMock).toHaveBeenCalledWith(
      prismaMock,
      expect.anything(),
      expect.objectContaining({ action: 'CREATE_ASSIGNMENT_OVERRIDE' }),
    );
  });

  it('rejects a target who is not a student on the roster', async () => {
    prismaMock.roster.findUnique.mockResolvedValue({ role: 'TA' });

    const res = await post({ userId: 'ta-1', dueDate: '2026-01-20' });

    expect(res.status).toBe(400);
    expect(prismaMock.assignmentOverride.create).not.toHaveBeenCalled();
    expect(activityLogMock).toHaveBeenCalledWith(
      prismaMock,
      expect.anything(),
      expect.objectContaining({ action: 'ASSIGNMENT_OVERRIDE_TARGET_INVALID', severity: 'SECURITY' }),
    );
  });

  it('rejects a target not enrolled at all', async () => {
    prismaMock.roster.findUnique.mockResolvedValue(null);

    const res = await post({ userId: 'ghost', dueDate: '2026-01-20' });

    expect(res.status).toBe(400);
    expect(prismaMock.assignmentOverride.create).not.toHaveBeenCalled();
  });

  it('rejects an override that changes nothing', async () => {
    prismaMock.roster.findUnique.mockResolvedValue({ role: 'STUDENT' });

    const res = await post({ userId: 'stu-1' });

    expect(res.status).toBe(400);
    expect(prismaMock.assignmentOverride.create).not.toHaveBeenCalled();
  });

  it('rejects an unlockAt after the due date', async () => {
    prismaMock.roster.findUnique.mockResolvedValue({ role: 'STUDENT' });

    const res = await post({ userId: 'stu-1', unlockAt: '2026-02-01' });

    expect(res.status).toBe(400);
    expect(prismaMock.assignmentOverride.create).not.toHaveBeenCalled();
  });

  it('returns 409 when an override already exists for the student', async () => {
    prismaMock.roster.findUnique.mockResolvedValue({ role: 'STUDENT' });
    const { Prisma } = await import('@prisma/client');
    prismaMock.assignmentOverride.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dupe', { code: 'P2002', clientVersion: 'x' }),
    );

    const res = await post({ userId: 'stu-1', dueDate: '2026-01-20' });

    expect(res.status).toBe(409);
  });

  it('returns 404 when the assignment is not in the course', async () => {
    prismaMock.assignment.findFirst.mockResolvedValue(null);

    const res = await post({ userId: 'stu-1', dueDate: '2026-01-20' });

    expect(res.status).toBe(404);
  });

  it('rejects a student already targeted through a group', async () => {
    prismaMock.roster.findUnique.mockResolvedValue({ role: 'STUDENT' });
    prismaMock.assignmentOverride.findFirst.mockResolvedValue({ id: 'grp-ov' }); // group clash

    const res = await post({ userId: 'stu-1', dueDate: '2026-01-20' });

    expect(res.status).toBe(400);
    expect(prismaMock.assignmentOverride.create).not.toHaveBeenCalled();
  });

  it('creates a group override, pins the group set, and stops assigning everyone', async () => {
    prismaMock.studentGroup.findFirst.mockResolvedValue({ id: 'g1', groupSetId: 'gs1' });
    prismaMock.groupMembership.findMany.mockResolvedValue([{ userId: 'm1' }, { userId: 'm2' }]);
    prismaMock.assignmentOverride.findFirst.mockResolvedValue(null); // no member clashes individually
    txMock.assignmentOverride.create.mockResolvedValue({
      id: 'og1',
      targetType: 'GROUP',
      userId: null,
      groupId: 'g1',
      unlockAt: null,
      dueDate: new Date('2026-01-20T23:59:00.000Z'),
      lateCutoff: null,
      allowLateSubmissions: null,
    });

    const res = await post({ groupId: 'g1', dueDate: '2026-01-20' });

    expect(res.status).toBe(201);
    expect(txMock.assignmentOverride.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ targetType: 'GROUP', groupId: 'g1' }) }),
    );
    expect(txMock.assignment.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { groupSetId: 'gs1', assignedToEveryone: false } }),
    );
  });

  it('rejects a group whose member is already targeted individually', async () => {
    prismaMock.studentGroup.findFirst.mockResolvedValue({ id: 'g1', groupSetId: 'gs1' });
    prismaMock.groupMembership.findMany.mockResolvedValue([{ userId: 'm1' }]);
    prismaMock.assignmentOverride.findFirst.mockResolvedValue({ id: 'stu-ov' }); // m1 targeted individually

    const res = await post({ groupId: 'g1', dueDate: '2026-01-20' });

    expect(res.status).toBe(400);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('rejects a group from a different group set', async () => {
    prismaMock.assignment.findFirst.mockResolvedValue({ ...BASE_ASSIGNMENT, groupSetId: 'gs-existing' });
    prismaMock.studentGroup.findFirst.mockResolvedValue({ id: 'g1', groupSetId: 'gs-other' });

    const res = await post({ groupId: 'g1', dueDate: '2026-01-20' });

    expect(res.status).toBe(400);
  });

  it('rejects a group not found in this course', async () => {
    prismaMock.studentGroup.findFirst.mockResolvedValue(null);

    const res = await post({ groupId: 'ghost', dueDate: '2026-01-20' });

    expect(res.status).toBe(400);
  });
});

describe('GET /api/courses/[id]/assignments/[aid]/overrides', () => {
  it('lists the assignment overrides', async () => {
    prismaMock.assignmentOverride.findMany.mockResolvedValue([{ id: 'o1', userId: 'stu-1' }]);

    const res = await GET(new NextRequest('http://localhost/x'), ctx);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ id: 'o1', userId: 'stu-1' }]);
  });

  it('returns 404 when the assignment is not in the course', async () => {
    prismaMock.assignment.findFirst.mockResolvedValue(null);

    const res = await GET(new NextRequest('http://localhost/x'), ctx);

    expect(res.status).toBe(404);
  });
});
