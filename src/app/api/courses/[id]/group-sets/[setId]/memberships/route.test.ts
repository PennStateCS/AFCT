import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const prismaMock = vi.hoisted(() => ({
  studentGroup: { findMany: vi.fn() },
  groupMembership: { findMany: vi.fn(), deleteMany: vi.fn(), upsert: vi.fn() },
  course: { findUnique: vi.fn() },
  roster: { findFirst: vi.fn() },
  $transaction: vi.fn(),
}));
const authMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());
const serviceMock = vi.hoisted(() => ({
  findGroupSet: vi.fn(),
  activeStudentIds: vi.fn(),
  loadGroupSetDetail: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));
vi.mock('@/lib/group-set-service', () => serviceMock);

import { POST } from './route';

const ctx = { params: { id: 'c1', setId: 'gs1' } } as never;
const txMock = { groupMembership: { deleteMany: vi.fn(), upsert: vi.fn() } };
const post = (body: unknown) =>
  POST(
    new NextRequest('http://localhost/api/courses/c1/group-sets/gs1/memberships', {
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
  serviceMock.loadGroupSetDetail.mockResolvedValue({ id: 'gs1', name: 'S', groups: [], eligibleStudents: [], basis: 'x' });
  serviceMock.activeStudentIds.mockResolvedValue(new Set(['u1', 'u2']));
  prismaMock.studentGroup.findMany.mockResolvedValue([{ id: 'g1' }, { id: 'g2' }]);
  txMock.groupMembership.deleteMany.mockReset();
  txMock.groupMembership.upsert.mockReset();
  prismaMock.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(txMock));
});

describe('POST memberships', () => {
  it('assigns, moves, and removes in one atomic transaction', async () => {
    const res = await post({
      operations: [
        { userId: 'u1', groupId: 'g1' }, // assign/move
        { userId: 'u2', groupId: 'g2' }, // assign/move
        { userId: 'u3', groupId: null }, // remove
      ],
    });
    expect(res.status).toBe(200);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(txMock.groupMembership.deleteMany).toHaveBeenCalledWith({
      where: { groupSetId: 'gs1', userId: { in: ['u3'] } },
    });
    // A move is a single upsert on the (set, user) key: never a two-group state.
    expect(txMock.groupMembership.upsert).toHaveBeenCalledTimes(2);
    expect(activityLogMock).toHaveBeenCalled();
  });

  it('rejects assigning an ineligible (inactive/non-student) student', async () => {
    serviceMock.activeStudentIds.mockResolvedValue(new Set(['u1'])); // u2 not eligible
    const res = await post({
      operations: [
        { userId: 'u1', groupId: 'g1' },
        { userId: 'u2', groupId: 'g1' },
      ],
    });
    expect(res.status).toBe(400);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('rejects a group that does not belong to the set', async () => {
    const res = await post({ operations: [{ userId: 'u1', groupId: 'other' }] });
    expect(res.status).toBe(400);
  });

  it('rejects duplicate userIds in one request', async () => {
    const res = await post({
      operations: [
        { userId: 'u1', groupId: 'g1' },
        { userId: 'u1', groupId: null },
      ],
    });
    expect(res.status).toBe(400);
  });

  it('409 when expectedBasis is stale', async () => {
    prismaMock.groupMembership.findMany.mockResolvedValue([{ userId: 'u1', groupId: 'g1' }]);
    const res = await post({
      operations: [{ userId: 'u2', groupId: 'g2' }],
      expectedBasis: 'definitely-stale',
    });
    expect(res.status).toBe(409);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('404 when the set is not in this course', async () => {
    serviceMock.findGroupSet.mockResolvedValue(null);
    const res = await post({ operations: [{ userId: 'u1', groupId: 'g1' }] });
    expect(res.status).toBe(404);
  });
});
