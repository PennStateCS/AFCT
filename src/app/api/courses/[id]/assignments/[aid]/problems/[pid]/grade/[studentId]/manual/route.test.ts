import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const prismaMock = vi.hoisted(() => ({
  assignmentProblemGrade: { findFirst: vi.fn(), update: vi.fn() },
  roster: { findFirst: vi.fn() },
  course: { findUnique: vi.fn() },
}));

const authMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());
const canManageCourseMock = vi.hoisted(() => vi.fn());
const canAccessCourseMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));
vi.mock('@/lib/permissions', () => ({
  canManageCourse: canManageCourseMock,
  canAccessCourse: canAccessCourseMock,
  isCourseArchived: async () => false,
}));

import { PATCH } from './route';

const params = { id: 'c1', aid: 'a1', pid: 'p1', studentId: 's1' };

const patch = (body: Record<string, unknown>) =>
  PATCH(
    new NextRequest('http://localhost/manual', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve(params) },
  );

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: 'fac1', isAdmin: true } });
  canManageCourseMock.mockResolvedValue(true);
  canAccessCourseMock.mockResolvedValue(true);
  prismaMock.assignmentProblemGrade.findFirst.mockResolvedValue({
    id: 'g1',
    grade: 8,
    gradedManually: true,
  });
  prismaMock.assignmentProblemGrade.update.mockResolvedValue({});
});

describe('PATCH grade manual hold', () => {
  it('releases a held grade back to the autograder', async () => {
    const res = await patch({ gradedManually: false });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ gradedManually: false });
    expect(prismaMock.assignmentProblemGrade.update).toHaveBeenCalledWith({
      where: { id: 'g1' },
      data: { gradedManually: false },
    });
  });

  it('holds a grade that was not held', async () => {
    prismaMock.assignmentProblemGrade.findFirst.mockResolvedValue({
      id: 'g1',
      grade: 8,
      gradedManually: false,
    });

    const res = await patch({ gradedManually: true });

    expect(res.status).toBe(200);
    expect(prismaMock.assignmentProblemGrade.update).toHaveBeenCalledWith({
      where: { id: 'g1' },
      data: { gradedManually: true },
    });
  });

  /**
   * Releasing a grade can change a student's mark later, when the submission is next re-run,
   * with nobody touching it again. That is why it is logged as its own act rather than folded
   * into a grade update, and why the two directions are named differently.
   */
  it('logs releasing and holding as different events', async () => {
    await patch({ gradedManually: false });
    expect(activityLogMock).toHaveBeenCalledWith(
      prismaMock,
      expect.anything(),
      expect.objectContaining({
        action: 'GRADE_RELEASED_TO_AUTOGRADER',
        category: 'GRADE',
        metadata: expect.objectContaining({ studentId: 's1', grade: 8 }),
      }),
    );

    vi.clearAllMocks();
    prismaMock.assignmentProblemGrade.findFirst.mockResolvedValue({
      id: 'g1',
      grade: 8,
      gradedManually: false,
    });
    await patch({ gradedManually: true });
    expect(activityLogMock).toHaveBeenCalledWith(
      prismaMock,
      expect.anything(),
      expect.objectContaining({ action: 'GRADE_HELD_MANUAL' }),
    );
  });

  // Setting it to what it already is changes nothing, so it should not write or log: an audit
  // full of no-op entries makes the real ones harder to find.
  it('does nothing when the state already matches', async () => {
    const res = await patch({ gradedManually: true });

    expect(res.status).toBe(200);
    expect(prismaMock.assignmentProblemGrade.update).not.toHaveBeenCalled();
    expect(activityLogMock).not.toHaveBeenCalled();
  });

  // There is nothing to hold until a grade exists; creating one here would invent a score
  // nobody entered.
  it('refuses when no grade has been recorded', async () => {
    prismaMock.assignmentProblemGrade.findFirst.mockResolvedValue(null);

    const res = await patch({ gradedManually: true });

    expect(res.status).toBe(404);
    expect(prismaMock.assignmentProblemGrade.update).not.toHaveBeenCalled();
  });

  // The lookup is scoped through the assignment to this course, so a grade id from elsewhere
  // cannot be flipped by guessing the path.
  it('scopes the lookup to this course', async () => {
    await patch({ gradedManually: false });

    expect(prismaMock.assignmentProblemGrade.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          assignmentId: 'a1',
          problemId: 'p1',
          studentId: 's1',
          assignmentProblem: { assignment: { courseId: 'c1' } },
        }),
      }),
    );
  });

  it('rejects a body without the flag', async () => {
    const res = await patch({});

    expect(res.status).toBe(400);
    expect(prismaMock.assignmentProblemGrade.update).not.toHaveBeenCalled();
  });

  it('returns 401 when not signed in', async () => {
    authMock.mockResolvedValue(null);

    const res = await patch({ gradedManually: false });

    expect(res.status).toBe(401);
  });

  it('returns 403 for someone who cannot manage the course', async () => {
    authMock.mockResolvedValue({ user: { id: 'stu1' } });
    canManageCourseMock.mockResolvedValue(false);

    const res = await patch({ gradedManually: false });

    expect(res.status).toBe(403);
    expect(prismaMock.assignmentProblemGrade.update).not.toHaveBeenCalled();
  });
});
