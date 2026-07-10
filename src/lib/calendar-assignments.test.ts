import { describe, it, expect, beforeEach, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  roster: { findMany: vi.fn(), groupBy: vi.fn() },
  assignment: { findMany: vi.fn() },
  submission: { findMany: vi.fn() },
  assignmentProblemGrade: { findMany: vi.fn(), groupBy: vi.fn() },
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { getAssignmentsForUserRange } from './calendar-assignments';

const range = { startDate: new Date('2026-01-01'), endDate: new Date('2026-02-01') };

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.assignment.findMany.mockResolvedValue([]);
  prismaMock.submission.findMany.mockResolvedValue([]);
  prismaMock.assignmentProblemGrade.findMany.mockResolvedValue([]);
  prismaMock.roster.groupBy.mockResolvedValue([]);
  prismaMock.assignmentProblemGrade.groupBy.mockResolvedValue([]);
});

describe('getAssignmentsForUserRange', () => {
  it('returns [] and skips the assignment query when the user has no courses', async () => {
    prismaMock.roster.findMany.mockResolvedValue([]);

    const res = await getAssignmentsForUserRange({ userId: 'u1', ...range });

    expect(res).toEqual([]);
    expect(prismaMock.assignment.findMany).not.toHaveBeenCalled();
  });

  it('shows all assignments for staff courses but only published ones for student courses', async () => {
    prismaMock.roster.findMany.mockResolvedValue([
      { courseId: 'staff-course', role: 'FACULTY' },
      { courseId: 'ta-course', role: 'TA' },
      { courseId: 'student-course', role: 'STUDENT' },
    ]);

    await getAssignmentsForUserRange({ userId: 'u1', ...range });

    const where = prismaMock.assignment.findMany.mock.calls[0][0].where;
    // Staff/TA courses: every assignment. Student course: gated on isPublished.
    expect(where.OR).toEqual([
      { courseId: { in: ['staff-course', 'ta-course'] } },
      { courseId: { in: ['student-course'] }, isPublished: true },
    ]);
    // The old unscoped `courseId: { in: [...] }` filter is gone.
    expect(where.courseId).toBeUndefined();
    // Archived and soft-deleted courses are excluded from the calendar for everyone.
    expect(where.course).toEqual({ isArchived: false, deletedAt: null });
  });
});
