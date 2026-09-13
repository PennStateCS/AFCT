import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const prismaMock = vi.hoisted(() => ({
  studentGroup: { findFirst: vi.fn(), create: vi.fn() },
  course: { findUnique: vi.fn() },
  roster: { findFirst: vi.fn() },
}));
const authMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());
const serviceMock = vi.hoisted(() => ({
  findGroupSet: vi.fn(),
  // The name check and the insert both run inside this now, under the set's row lock, which is
  // what serialises two creations racing on names that differ only by case.
  withUnlockedGroupSet: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));
vi.mock('@/lib/group-set-service', () => serviceMock);

import { POST } from './route';

const ctx = { params: { id: 'c1', setId: 'gs1' } } as never;
const txMock = { studentGroup: { findFirst: vi.fn(), create: vi.fn() } };
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
  txMock.studentGroup.findFirst.mockReset();
  txMock.studentGroup.create.mockReset();
  serviceMock.withUnlockedGroupSet.mockImplementation(
    async (_setId: string, work: (tx: unknown) => unknown) => work(txMock),
  );
});

describe('POST create group in a set', () => {
  /**
   * Two check-then-acts used to sit here: the set could become permanently locked between the
   * check and the create, and the name clash was tested case-insensitively while the database
   * constraint behind it is case-sensitive, so "Project Teams" and "project teams" could both
   * pass and both land. Holding the set's row for the whole thing closes both, because every
   * creation in a set now queues on the same row.
   */
  it('does the name check and the insert inside the set lock', async () => {
    txMock.studentGroup.findFirst.mockResolvedValue(null);
    txMock.studentGroup.create.mockResolvedValue({ id: 'g9', name: 'Group 1' });

    await post({ name: 'Group 1' });

    expect(serviceMock.withUnlockedGroupSet).toHaveBeenCalledTimes(1);
    expect(serviceMock.withUnlockedGroupSet.mock.calls[0]?.[0]).toBe('gs1');
    // Both through the transaction client, not the bare prisma one: outside the lock they
    // would be exactly the race they replaced.
    expect(txMock.studentGroup.findFirst).toHaveBeenCalled();
    expect(txMock.studentGroup.create).toHaveBeenCalled();
  });

  it('409 on a duplicate group name within the set (case-insensitive)', async () => {
    txMock.studentGroup.findFirst.mockResolvedValue({ id: 'g1' });
    const res = await post({ name: ' group 1 ' });
    expect(res.status).toBe(409);
    expect(txMock.studentGroup.create).not.toHaveBeenCalled();
  });

  it('creates the group when the name is free in this set', async () => {
    txMock.studentGroup.findFirst.mockResolvedValue(null);
    txMock.studentGroup.create.mockResolvedValue({ id: 'g9', name: 'Group 1' });
    const res = await post({ name: 'Group 1' });
    expect(res.status).toBe(201);
    // The uniqueness check is scoped to this set, so the same name is free in
    // other sets (that scoping is exactly what the where-clause encodes).
    expect(txMock.studentGroup.findFirst.mock.calls[0]![0].where.groupSetId).toBe('gs1');
    expect(activityLogMock).toHaveBeenCalled();
  });

  it('404 when the set is not in this course', async () => {
    serviceMock.findGroupSet.mockResolvedValue(null);
    const res = await post({ name: 'Group 1' });
    expect(res.status).toBe(404);
  });
});
