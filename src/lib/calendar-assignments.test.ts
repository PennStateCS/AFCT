import { describe, it, expect, beforeEach, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  roster: { findMany: vi.fn(), groupBy: vi.fn() },
  assignment: { findMany: vi.fn() },
  submission: { findMany: vi.fn() },
  assignmentProblemGrade: { findMany: vi.fn(), groupBy: vi.fn() },
  user: { findUnique: vi.fn() },
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
  prismaMock.user.findUnique.mockResolvedValue({ isAdmin: false });
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
    // Staff/TA courses: every assignment. Student course: gated on the assignment
    // AND the course being published: a student in an unpublished course must not
    // see anything from it, even a published assignment.
    expect(where.OR).toEqual([
      { courseId: { in: ['staff-course', 'ta-course'] } },
      {
        courseId: { in: ['student-course'] },
        isPublished: true,
        course: { isPublished: true },
      },
    ]);
    // The old unscoped `courseId: { in: [...] }` filter is gone.
    expect(where.courseId).toBeUndefined();
    // Archived and soft-deleted courses are excluded from the calendar for everyone.
    expect(where.course).toEqual({ isArchived: false, deletedAt: null });
  });

  it('treats every rostered course as staff when the viewer is an admin', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ isAdmin: true });
    prismaMock.roster.findMany.mockResolvedValue([
      { courseId: 'enrolled-as-student', role: 'STUDENT' },
    ]);

    await getAssignmentsForUserRange({ userId: 'admin1', ...range });

    const where = prismaMock.assignment.findMany.mock.calls[0][0].where;
    // The global admin flag outranks the STUDENT roster row: no publish gating.
    expect(where.OR).toEqual([
      { courseId: { in: ['enrolled-as-student'] } },
      { courseId: { in: [] }, isPublished: true, course: { isPublished: true } },
    ]);
  });

  it('selects and carries isPublished through so staff drafts can be marked', async () => {
    prismaMock.roster.findMany.mockResolvedValue([{ courseId: 'staff-course', role: 'FACULTY' }]);
    prismaMock.assignment.findMany.mockResolvedValue([
      {
        id: 'a1',
        title: 'Draft One',
        courseId: 'staff-course',
        dueDate: new Date('2026-01-15'),
        isPublished: false,
        course: { id: 'staff-course', code: 'CS1', name: 'Course One' },
      },
    ]);

    const res = await getAssignmentsForUserRange({ userId: 'u1', ...range });

    expect(prismaMock.assignment.findMany.mock.calls[0][0].select.isPublished).toBe(true);
    expect(res).toHaveLength(1);
    expect(res[0].isPublished).toBe(false);
  });
});
