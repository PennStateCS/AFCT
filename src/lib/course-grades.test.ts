import { describe, it, expect, beforeEach, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  roster: { findMany: vi.fn() },
  user: { findMany: vi.fn() },
  assignment: { findMany: vi.fn() },
  groupMembership: { findMany: vi.fn() },
  assignmentProblemGrade: { groupBy: vi.fn() },
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { getCourseGradeMatrix } from './course-grades';

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.roster.findMany.mockResolvedValue([{ userId: 's1' }, { userId: 's2' }]);
  prismaMock.user.findMany.mockResolvedValue([
    { id: 's1', firstName: 'Ada', lastName: 'L', email: 'a@x.io', avatar: null, cropX: null, cropY: null, zoom: null },
    { id: 's2', firstName: 'Alan', lastName: 'T', email: 't@x.io', avatar: null, cropX: null, cropY: null, zoom: null },
  ]);
  prismaMock.groupMembership.findMany.mockResolvedValue([]);
  prismaMock.assignmentProblemGrade.groupBy.mockResolvedValue([]);
});

describe('getCourseGradeMatrix — assigned map', () => {
  it('marks students assigned via everyone, individual override, and group override', async () => {
    prismaMock.assignment.findMany.mockResolvedValue([
      // Assigned to everyone: both students assigned.
      { id: 'a1', title: 'A1', dueDate: null, assignedToEveryone: true, problems: [], overrides: [] },
      // Not everyone, individual override for s1 only.
      {
        id: 'a2',
        title: 'A2',
        dueDate: null,
        assignedToEveryone: false,
        problems: [],
        overrides: [{ userId: 's1', groupId: null }],
      },
      // Not everyone, group override on g1 (s2 is a member).
      {
        id: 'a3',
        title: 'A3',
        dueDate: null,
        assignedToEveryone: false,
        problems: [],
        overrides: [{ userId: null, groupId: 'g1' }],
      },
    ]);
    prismaMock.groupMembership.findMany.mockResolvedValue([{ userId: 's2', groupId: 'g1' }]);

    const matrix = await getCourseGradeMatrix('c1');

    // Everyone -> both assigned.
    expect(matrix.assigned.s1.a1).toBe(true);
    expect(matrix.assigned.s2.a1).toBe(true);
    // Individual override for s1 only.
    expect(matrix.assigned.s1.a2).toBe(true);
    expect(matrix.assigned.s2.a2).toBe(false);
    // Group override: only the group member (s2) is assigned.
    expect(matrix.assigned.s1.a3).toBe(false);
    expect(matrix.assigned.s2.a3).toBe(true);

    // Membership lookup is batched into a single query for the whole roster.
    expect(prismaMock.groupMembership.findMany).toHaveBeenCalledTimes(1);
  });
});
