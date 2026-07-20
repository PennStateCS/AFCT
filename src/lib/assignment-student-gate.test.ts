import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  assignment: { findFirst: vi.fn() },
  assignmentOverride: { findMany: vi.fn() },
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { resolveStudentContentGate } from './assignment-student-gate';

const NOW = new Date('2026-07-20T12:00:00.000Z');
const base = {
  unlockAt: null as Date | null,
  dueDate: new Date('2026-08-01T23:59:00.000Z'),
  allowLateSubmissions: false,
  lateCutoff: null as Date | null,
};

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.assignmentOverride.findMany.mockResolvedValue([]);
});

describe('resolveStudentContentGate', () => {
  it('reports not assigned when the membership-filtered lookup finds nothing', async () => {
    prismaMock.assignment.findFirst.mockResolvedValue(null);

    const gate = await resolveStudentContentGate('a1', 'stu-1', NOW);

    expect(gate).toEqual({ assigned: false, locked: true, unlockAt: null });
    // The lookup must carry the membership filter, not just the id.
    const where = prismaMock.assignment.findFirst.mock.calls[0][0].where;
    expect(where.id).toBe('a1');
    expect(where.OR).toEqual([
      { assignedToEveryone: true },
      { assignees: { some: { userId: 'stu-1' } } },
      { assignees: { some: { studentGroup: { memberships: { some: { userId: 'stu-1' } } } } } },
    ]);
  });

  it('is assigned and unlocked when there is no unlock date', async () => {
    prismaMock.assignment.findFirst.mockResolvedValue(base);

    const gate = await resolveStudentContentGate('a1', 'stu-1', NOW);

    expect(gate).toEqual({ assigned: true, locked: false, unlockAt: null });
  });

  it('locks while the base unlock date is still in the future', async () => {
    const unlockAt = new Date('2026-07-25T00:00:00.000Z');
    prismaMock.assignment.findFirst.mockResolvedValue({ ...base, unlockAt });

    const gate = await resolveStudentContentGate('a1', 'stu-1', NOW);

    expect(gate.assigned).toBe(true);
    expect(gate.locked).toBe(true);
    expect(gate.unlockAt).toEqual(unlockAt);
  });

  it('unlocks early when the student has an override that already opened', async () => {
    prismaMock.assignment.findFirst.mockResolvedValue({
      ...base,
      unlockAt: new Date('2026-07-25T00:00:00.000Z'),
    });
    prismaMock.assignmentOverride.findMany.mockResolvedValue([
      {
        targetType: 'STUDENT',
        userId: 'stu-1',
        groupId: null,
        unlockAt: new Date('2026-07-01T00:00:00.000Z'),
        dueDate: null,
        lateCutoff: null,
        allowLateSubmissions: null,
      },
    ]);

    const gate = await resolveStudentContentGate('a1', 'stu-1', NOW);

    expect(gate.locked).toBe(false);
  });

  it('honors a group override, deriving the group id from the scoped rows', async () => {
    prismaMock.assignment.findFirst.mockResolvedValue(base);
    prismaMock.assignmentOverride.findMany.mockResolvedValue([
      {
        targetType: 'GROUP',
        userId: null,
        groupId: 'g1',
        unlockAt: new Date('2026-07-30T00:00:00.000Z'),
        dueDate: null,
        lateCutoff: null,
        allowLateSubmissions: null,
      },
    ]);

    const gate = await resolveStudentContentGate('a1', 'stu-1', NOW);

    expect(gate.locked).toBe(true);
    expect(gate.unlockAt).toEqual(new Date('2026-07-30T00:00:00.000Z'));
  });
});
