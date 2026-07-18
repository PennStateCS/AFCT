import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const prismaMock = vi.hoisted(() => ({
  groupSet: { findFirst: vi.fn() },
  course: { findUnique: vi.fn() },
  roster: { findFirst: vi.fn() },
  $transaction: vi.fn(),
}));
const authMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());
const serviceMock = vi.hoisted(() => ({ activeStudentIds: vi.fn() }));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));
vi.mock('@/lib/group-set-service', () => serviceMock);

import { POST } from './route';

const ctx = { params: { id: 'c1', setId: 'gs1' } } as never;
const txMock = {
  groupSet: { create: vi.fn() },
  studentGroup: { create: vi.fn() },
  groupMembership: { createMany: vi.fn() },
};
const post = (body: unknown) =>
  POST(
    new NextRequest('http://localhost/api/courses/c1/group-sets/gs1/duplicate', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    ctx,
  );

const source = {
  id: 'gs1',
  name: 'Project 1',
  groups: [
    { id: 'g1', name: 'Group 1', memberships: [{ userId: 'active1' }, { userId: 'inactive1' }] },
    { id: 'g2', name: 'Group 2', memberships: [] },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: 'staff', role: 'FACULTY' } });
  prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });
  prismaMock.course.findUnique.mockResolvedValue({ isArchived: false });
  txMock.groupSet.create.mockResolvedValue({ id: 'gs2', name: 'Project 1 Copy' });
  txMock.studentGroup.create.mockImplementation(async ({ data }: { data: { name: string } }) => ({
    id: `n-${data.name}`,
    name: data.name,
  }));
  txMock.groupMembership.createMany.mockReset();
  prismaMock.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(txMock));
});

describe('POST duplicate', () => {
  it('409 on a duplicate name', async () => {
    prismaMock.groupSet.findFirst.mockResolvedValueOnce(source).mockResolvedValueOnce({ id: 'x' });
    const res = await post({ name: 'Project 1 Copy' });
    expect(res.status).toBe(409);
  });

  it('404 when the source set is missing', async () => {
    prismaMock.groupSet.findFirst.mockResolvedValueOnce(null);
    const res = await post({ name: 'Project 1 Copy' });
    expect(res.status).toBe(404);
  });

  it('copies groups only, without any memberships', async () => {
    prismaMock.groupSet.findFirst.mockResolvedValueOnce(source).mockResolvedValueOnce(null);
    const res = await post({ name: 'Project 1 Copy', includeMemberships: false });
    expect(res.status).toBe(201);
    expect(txMock.studentGroup.create).toHaveBeenCalledTimes(2);
    expect(txMock.groupMembership.createMany).not.toHaveBeenCalled();
  });

  it('copies memberships but excludes inactive students', async () => {
    prismaMock.groupSet.findFirst.mockResolvedValueOnce(source).mockResolvedValueOnce(null);
    serviceMock.activeStudentIds.mockResolvedValue(new Set(['active1'])); // inactive1 dropped
    const res = await post({ name: 'Project 1 Copy', includeMemberships: true });
    expect(res.status).toBe(201);
    const createManyRows = txMock.groupMembership.createMany.mock.calls.flatMap(
      (c) => (c[0] as { data: { userId: string }[] }).data,
    );
    expect(createManyRows.map((r) => r.userId)).toEqual(['active1']);
  });
});
