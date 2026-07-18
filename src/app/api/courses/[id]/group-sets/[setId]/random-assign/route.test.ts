import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const prismaMock = vi.hoisted(() => ({
  course: { findUnique: vi.fn() },
  roster: { findFirst: vi.fn() },
}));
const authMock = vi.hoisted(() => vi.fn());
const serviceMock = vi.hoisted(() => ({
  findGroupSet: vi.fn(),
  activeStudentIds: vi.fn(),
  loadGroupSetDetail: vi.fn(),
  assertGroupSetUnlocked: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: vi.fn() }));
vi.mock('@/lib/group-set-service', () => serviceMock);

import { POST } from './route';

const ctx = { params: { id: 'c1', setId: 'gs1' } } as never;
const student = (id: string) => ({ id, firstName: id, lastName: 'X', email: `${id}@e.com` });
const post = (body: unknown) =>
  POST(
    new NextRequest('http://localhost/api/courses/c1/group-sets/gs1/random-assign', {
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
  serviceMock.activeStudentIds.mockResolvedValue(new Set(['a', 'b', 'c', 'd']));
});

describe('POST random-assign preview', () => {
  it('400 when the set has no groups', async () => {
    serviceMock.loadGroupSetDetail.mockResolvedValue({
      id: 'gs1',
      name: 'S',
      locked: false,
      groups: [],
      eligibleStudents: [student('a')],
      basis: 'b',
    });
    const res = await post({ studentIds: ['a'], reassignSelected: false });
    expect(res.status).toBe(400);
  });

  it('previews a balanced split without writing', async () => {
    serviceMock.loadGroupSetDetail.mockResolvedValue({
      id: 'gs1',
      name: 'S',
      locked: false,
      groups: [
        { id: 'g1', name: 'G1', members: [] },
        { id: 'g2', name: 'G2', members: [] },
      ],
      eligibleStudents: ['a', 'b', 'c', 'd'].map(student),
      basis: 'b0',
    });
    const res = await post({ studentIds: ['a', 'b', 'c', 'd'], reassignSelected: false });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.placedCount).toBe(4);
    expect(body.basis).toBe('b0');
    const sizes = body.groups.map((g: { members: unknown[] }) => g.members.length).sort();
    expect(sizes).toEqual([2, 2]);
  });

  it('404 when the set is not in this course', async () => {
    serviceMock.findGroupSet.mockResolvedValue(null);
    const res = await post({ studentIds: ['a'], reassignSelected: false });
    expect(res.status).toBe(404);
  });
});
