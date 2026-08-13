import { visibleAssignmentsForWidth } from '@/lib/calendar-shared';
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
    // Staff/TA courses: every assignment whose base due is in range. Student course:
    // gated on the assignment AND the course being published, matched on the base due
    // OR this student's own override due (so an extension moves the date correctly).
    expect(where.OR).toEqual([
      {
        courseId: { in: ['staff-course', 'ta-course'] },
        dueDate: { gte: range.startDate, lte: range.endDate },
      },
      {
        courseId: { in: ['student-course'] },
        isPublished: true,
        course: { isPublished: true },
        AND: [
          {
            OR: [
              { dueDate: { gte: range.startDate, lte: range.endDate } },
              { overrides: { some: { userId: 'u1', dueDate: { gte: range.startDate, lte: range.endDate } } } },
            ],
          },
          { OR: [{ assignedToEveryone: true }, { overrides: { some: { userId: 'u1' } } }] },
        ],
      },
    ]);
    // The old top-level `dueDate` and unscoped `courseId` filters are gone.
    expect(where.courseId).toBeUndefined();
    expect(where.dueDate).toBeUndefined();
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
    // The global admin flag outranks the STUDENT roster row: no publish gating, and the
    // student branch (with its override match) targets an empty course set.
    expect(where.OR).toEqual([
      {
        courseId: { in: ['enrolled-as-student'] },
        dueDate: { gte: range.startDate, lte: range.endDate },
      },
      {
        courseId: { in: [] },
        isPublished: true,
        course: { isPublished: true },
        AND: [
          {
            OR: [
              { dueDate: { gte: range.startDate, lte: range.endDate } },
              { overrides: { some: { userId: 'admin1', dueDate: { gte: range.startDate, lte: range.endDate } } } },
            ],
          },
          { OR: [{ assignedToEveryone: true }, { overrides: { some: { userId: 'admin1' } } }] },
        ],
      },
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

/**
 * How much a day cell tries to show at a given viewport width.
 *
 * The cell is square, so its height is its width. Below `sm` that is about 36 pixels, which
 * holds the date and nothing else: a chip there truncates to three or four characters and says
 * less than the dot the cell falls back to.
 *
 * Tested here rather than through the calendar, because this is the part that is a decision. The
 * rendering it drives is layout, and jsdom does no layout: `CalendarClient.test.tsx` mocks the
 * calendar away entirely, so no day cell renders there and a test asserting on chips would pass
 * or fail for reasons unrelated to width.
 */
describe('how many assignments fit in a day cell', () => {
  it('shows none on a phone, where the cell has room for the date alone', () => {
    expect(visibleAssignmentsForWidth(360)).toBe(0);
    expect(visibleAssignmentsForWidth(390)).toBe(0);
  });

  it('shows one on a small tablet', () => {
    expect(visibleAssignmentsForWidth(640)).toBe(1);
    expect(visibleAssignmentsForWidth(767)).toBe(1);
  });

  it('shows two at a normal window size', () => {
    expect(visibleAssignmentsForWidth(768)).toBe(2);
    expect(visibleAssignmentsForWidth(1279)).toBe(2);
  });

  it('shows three on a wide screen', () => {
    expect(visibleAssignmentsForWidth(1280)).toBe(3);
    expect(visibleAssignmentsForWidth(2560)).toBe(3);
  });

  // The boundaries are the whole content of this function, so they are what gets pinned.
  it('changes exactly at the breakpoints and nowhere else', () => {
    expect(visibleAssignmentsForWidth(639)).toBe(0);
    expect(visibleAssignmentsForWidth(640)).toBe(1);
    expect(visibleAssignmentsForWidth(767)).toBe(1);
    expect(visibleAssignmentsForWidth(768)).toBe(2);
  });
});
