/** @vitest-environment jsdom */

import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { post, patch } = vi.hoisted(() => ({ post: vi.fn(), patch: vi.fn() }));
vi.mock('@/lib/api/fetch-client', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  apiClient: { post, patch },
}));

const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock('@/lib/toast', () => ({
  showToast: { success: toastSuccess, error: toastError },
}));

import { useProblemGrades } from './useProblemGrades';
import { ApiError } from '@/lib/api/fetch-client';

const problems = [
  { id: 'p1', title: 'One', maxPoints: 10 },
  { id: 'p2', title: 'Two', maxPoints: 20 },
];
const students = [{ id: 's1' }, { id: 's2' }];
const selectedStudent = { id: 's1', firstName: 'Ada', lastName: 'Lovelace' };

const reviewData = {
  problemGrades: {
    p1: { grade: 8, feedback: null, groupGradeValue: null, gradedManually: true },
  },
} as never;

const wrapper = ({ children }: { children: React.ReactNode }) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};

const setup = (over: Record<string, unknown> = {}) =>
  renderHook(
    () =>
      useProblemGrades({
        courseId: 'c1',
        assignmentId: 'a1',
        courseIsArchived: false,
        students,
        selectedStudent,
        assignmentProblems: problems,
        reviewData,
        reviewQueryIsError: false,
        reviewError: null,
        group: null,
        groupMembers: [],
        ...over,
      } as never),
    { wrapper },
  );

beforeEach(() => {
  vi.clearAllMocks();
  // The grade summary query; every student ungraded unless a test says otherwise.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({}) })),
  );
});

describe('useProblemGrades', () => {
  it('seeds the editable fields from the review data', async () => {
    const { result } = setup();

    await waitFor(() => expect(result.current.problemGrades.p1).toBe(8));
    expect(result.current.gradeInputs.p1).toBe('8');
    // A problem with no grade recorded reads as empty rather than zero.
    expect(result.current.problemGrades.p2).toBeNull();
    expect(result.current.gradeInputs.p2).toBe('');
  });

  describe('validation', () => {
    // Each of these must stop before the write: a rejected grade should never reach the
    // server, and the field should say why.
    it.each([
      ['not a number', 'abc', 'Enter the grade as a number.'],
      ['negative', '-1', 'Enter a grade of at least 0.'],
      ['above the maximum', '99', 'Enter a grade between 0 and 10.'],
    ])('refuses a grade that is %s', async (_name, typed, message) => {
      const { result } = setup();
      await waitFor(() => expect(result.current.gradeInputs.p1).toBe('8'));

      act(() => result.current.handleGradeInputChange('p1', typed));
      await act(async () => {
        await result.current.saveProblemGrade('p1');
      });

      expect(post).not.toHaveBeenCalled();
      expect(result.current.problemGradeErrors.p1).toBe(message);
      expect(toastError).toHaveBeenCalledWith(message);
    });

    it('refuses to save on an archived course', async () => {
      const { result } = setup({ courseIsArchived: true });
      await waitFor(() => expect(result.current.gradeInputs.p1).toBe('8'));

      act(() => result.current.handleGradeInputChange('p1', '9'));
      await act(async () => {
        await result.current.saveProblemGrade('p1');
      });

      expect(post).not.toHaveBeenCalled();
    });
  });

  describe('saving one student', () => {
    it('posts to the per-student route', async () => {
      post.mockResolvedValue({});
      const { result } = setup();
      await waitFor(() => expect(result.current.gradeInputs.p1).toBe('8'));

      act(() => result.current.handleGradeInputChange('p1', '9'));
      await act(async () => {
        await result.current.saveProblemGrade('p1');
      });

      expect(post).toHaveBeenCalledWith(
        '/api/courses/c1/assignments/a1/problems/p1/grade/s1',
        { grade: 9 },
      );
    });

    /**
     * The student picker shows each student's total, and it comes from the summary query,
     * which is deliberately NOT refetched after a save (that would overwrite the optimistic
     * dot). So the total has to be adjusted here or the picker keeps showing the old figure.
     */
    it('keeps the student total in step with the change', async () => {
      post.mockResolvedValue({});
      const { result } = setup();
      await waitFor(() => expect(result.current.problemGrades.p1).toBe(8));
      const before = result.current.studentEarned.s1 ?? 0;

      act(() => result.current.handleGradeInputChange('p1', '10'));
      await act(async () => {
        await result.current.saveProblemGrade('p1');
      });

      // 8 -> 10 is two more points.
      expect(result.current.studentEarned.s1).toBe(before + 2);
    });

    it('reports a failed save without losing what was typed', async () => {
      post.mockRejectedValue(new Error('boom'));
      const { result } = setup();
      await waitFor(() => expect(result.current.gradeInputs.p1).toBe('8'));

      act(() => result.current.handleGradeInputChange('p1', '9'));
      await act(async () => {
        await result.current.saveProblemGrade('p1');
      });

      expect(toastError).toHaveBeenCalled();
      expect(result.current.problemGradeErrors.p1).toBe('boom');
      expect(result.current.gradeInputs.p1).toBe('9');
    });
  });

  describe('grading a group', () => {
    const group = { id: 'g1', name: 'Group 3' };
    const groupMembers = [{ id: 's2' }];

    it('sends one write for the group rather than one per member', async () => {
      post.mockResolvedValue({});
      const { result } = setup({ group, groupMembers });
      await waitFor(() => expect(result.current.gradeInputs.p1).toBe('8'));

      act(() => result.current.handleGradeInputChange('p1', '9'));
      await act(async () => {
        await result.current.saveProblemGrade('p1');
      });

      expect(post).toHaveBeenCalledWith(
        '/api/courses/c1/assignments/a1/problems/p1/group-grade/g1',
        { grade: 9 },
      );
    });

    it('grades the one student when the target is switched', async () => {
      post.mockResolvedValue({});
      const { result } = setup({ group, groupMembers });
      await waitFor(() => expect(result.current.gradeInputs.p1).toBe('8'));

      act(() => result.current.setGradeTarget('student'));
      act(() => result.current.handleGradeInputChange('p1', '9'));
      await act(async () => {
        await result.current.saveProblemGrade('p1');
      });

      expect(post).toHaveBeenCalledWith(
        '/api/courses/c1/assignments/a1/problems/p1/grade/s1',
        { grade: 9 },
      );
    });

    // The server declines rather than overwriting somebody's deliberate adjustment. The hook
    // has to hold the write and surface who, not retry behind the grader's back.
    it('holds the write when members already differ', async () => {
      post.mockRejectedValue(
        new ApiError('conflict', 409, {
          conflicts: [{ studentId: 's2', name: 'Grace Hopper', grade: 5 }],
        }),
      );
      const { result } = setup({ group, groupMembers });
      await waitFor(() => expect(result.current.gradeInputs.p1).toBe('8'));

      act(() => result.current.handleGradeInputChange('p1', '9'));
      await act(async () => {
        await result.current.saveProblemGrade('p1');
      });

      expect(result.current.pendingGroupGrade).toMatchObject({
        problemId: 'p1',
        grade: 9,
        groupName: 'Group 3',
        conflicts: [{ studentId: 's2', name: 'Grace Hopper', grade: 5 }],
      });
      expect(toastSuccess).not.toHaveBeenCalled();
      // The first attempt must NOT ask to overwrite, or the server would apply it and the
      // confirmation would be asking about something already done.
      expect(post).toHaveBeenCalledWith(expect.any(String), { grade: 9 });
    });

    it('retries with overwrite once confirmed', async () => {
      post.mockRejectedValueOnce(
        new ApiError('conflict', 409, {
          conflicts: [{ studentId: 's2', name: 'Grace Hopper', grade: 5 }],
        }),
      );
      const { result } = setup({ group, groupMembers });
      await waitFor(() => expect(result.current.gradeInputs.p1).toBe('8'));

      act(() => result.current.handleGradeInputChange('p1', '9'));
      await act(async () => {
        await result.current.saveProblemGrade('p1');
      });

      post.mockResolvedValue({});
      await act(async () => {
        await result.current.confirmGroupGrade();
      });

      expect(post).toHaveBeenLastCalledWith(
        '/api/courses/c1/assignments/a1/problems/p1/group-grade/g1',
        { grade: 9, overwrite: true },
      );
      expect(result.current.pendingGroupGrade).toBeNull();
    });

    it('writes nothing when the grader backs out', async () => {
      post.mockRejectedValue(
        new ApiError('conflict', 409, { conflicts: [{ studentId: 's2', name: 'G', grade: 5 }] }),
      );
      const { result } = setup({ group, groupMembers });
      await waitFor(() => expect(result.current.gradeInputs.p1).toBe('8'));

      act(() => result.current.handleGradeInputChange('p1', '9'));
      await act(async () => {
        await result.current.saveProblemGrade('p1');
      });
      const callsBefore = post.mock.calls.length;

      act(() => result.current.cancelGroupGrade());

      expect(result.current.pendingGroupGrade).toBeNull();
      expect(post.mock.calls).toHaveLength(callsBefore);
    });
  });

  describe('holding a grade against the autograder', () => {
    it('releases it back', async () => {
      patch.mockResolvedValue({});
      const { result } = setup();
      await waitFor(() => expect(result.current.gradeInputs.p1).toBe('8'));

      await act(async () => {
        await result.current.setManualHold('p1', false);
      });

      expect(patch).toHaveBeenCalledWith(
        '/api/courses/c1/assignments/a1/problems/p1/grade/s1/manual',
        { gradedManually: false },
      );
      expect(toastSuccess).toHaveBeenCalledWith('Grade released to the autograder');
    });

    it('reports a failure rather than appearing to succeed', async () => {
      patch.mockRejectedValue(new Error('nope'));
      const { result } = setup();
      await waitFor(() => expect(result.current.gradeInputs.p1).toBe('8'));

      await act(async () => {
        await result.current.setManualHold('p1', true);
      });

      expect(toastError).toHaveBeenCalled();
      expect(toastSuccess).not.toHaveBeenCalled();
    });
  });
});
