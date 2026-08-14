/** @vitest-environment jsdom */
import { act, createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useSubmissionFilters } from './use-submission-filters';
import type { AssignmentItem, CourseItem, ProblemItem } from './submissions-data';

/**
 * The cascading pickers, and in particular the pruning.
 *
 * This is the part of the submissions page that is easy to get wrong and impossible to see: a
 * selected assignment id that outlives the course offering it keeps filtering the table, and
 * the table then shows nothing with no visible reason why. It could not be tested while it
 * lived inside the component, because reaching it meant rendering the whole page.
 *
 * The fetchers are mocked here on purpose. They have their own tests in
 * `submissions-data.test.ts`; what matters below is what the hook does with the lists.
 */

const fetchCourseList = vi.fn();
const fetchAssignmentsForCourses = vi.fn();
const fetchProblemsForAssignments = vi.fn();

vi.mock('./submissions-data', () => ({
  fetchCourseList: (...args: unknown[]) => fetchCourseList(...args),
  fetchAssignmentsForCourses: (...args: unknown[]) => fetchAssignmentsForCourses(...args),
  fetchProblemsForAssignments: (...args: unknown[]) => fetchProblemsForAssignments(...args),
}));

const errorToast = vi.fn();
vi.mock('@/lib/toast', () => ({ showToast: { error: (m: string) => errorToast(m) } }));

const course = (id: string, over: Partial<CourseItem> = {}): CourseItem =>
  ({ id, name: `Course ${id}`, code: `C${id}`, ...over }) as CourseItem;

const assignment = (id: string, courseId = 'c1'): AssignmentItem => ({
  id,
  title: `Assignment ${id}`,
  courseId,
  problems: [],
});

const problem = (id: string): ProblemItem =>
  ({ id, title: `Problem ${id}` }) as ProblemItem;

// A fresh client per test so one case's cached course list cannot answer the next one.
const createWrapper = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
};

const render = () => renderHook(() => useSubmissionFilters(), { wrapper: createWrapper() });

beforeEach(() => {
  vi.clearAllMocks();
  fetchCourseList.mockResolvedValue([course('c1'), course('c2')]);
  fetchAssignmentsForCourses.mockResolvedValue([]);
  fetchProblemsForAssignments.mockResolvedValue([]);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('opening the page', () => {
  it('starts with nothing selected, so the table is unfiltered', async () => {
    const { result } = render();

    expect(result.current.selectedCourses).toEqual([]);
    expect(result.current.anyScopeActive).toBe(false);
    await waitFor(() => expect(result.current.courseOptions).toHaveLength(2));
  });

  /**
   * The lists below the top one stay unasked until something is selected. This is the fix for
   * a page that used to fan out one request per course and then one per assignment before it
   * could show a single row.
   */
  it('does not ask for assignments or problems until a course is chosen', async () => {
    const { result } = render();

    await waitFor(() => expect(result.current.courseOptions).toHaveLength(2));

    expect(fetchAssignmentsForCourses).not.toHaveBeenCalled();
    expect(fetchProblemsForAssignments).not.toHaveBeenCalled();
  });

  it('asks for the assignments once a course is chosen', async () => {
    fetchAssignmentsForCourses.mockResolvedValue([assignment('a1')]);
    const { result } = render();

    act(() => result.current.setSelectedCourses(['c1']));

    await waitFor(() => expect(result.current.assignmentOptions).toHaveLength(1));
    expect(fetchAssignmentsForCourses).toHaveBeenCalledWith(['c1']);
  });
});

describe('pruning a selection when the list beneath changes', () => {
  /**
   * The guard. Pick assignments, then move to a course that does not offer them: the ids have
   * to go. Left in place they keep filtering the query, and the table shows an empty page for
   * a course that has submissions.
   */
  it('drops a selected assignment when its course is deselected', async () => {
    fetchAssignmentsForCourses.mockResolvedValue([assignment('a1'), assignment('a2')]);
    const { result } = render();

    act(() => result.current.setSelectedCourses(['c1']));
    await waitFor(() => expect(result.current.assignmentOptions).toHaveLength(2));
    act(() => result.current.setSelectedAssignments(['a1', 'a2']));

    // Switch to a course whose assignments are entirely different.
    fetchAssignmentsForCourses.mockResolvedValue([assignment('a9', 'c2')]);
    act(() => result.current.setSelectedCourses(['c2']));

    await waitFor(() => expect(result.current.selectedAssignments).toEqual([]));
  });

  it('keeps the selected assignments that the new list still offers', async () => {
    fetchAssignmentsForCourses.mockResolvedValue([assignment('a1'), assignment('a2')]);
    const { result } = render();

    act(() => result.current.setSelectedCourses(['c1']));
    await waitFor(() => expect(result.current.assignmentOptions).toHaveLength(2));
    act(() => result.current.setSelectedAssignments(['a1', 'a2']));

    // c2 still offers a1 but not a2.
    fetchAssignmentsForCourses.mockResolvedValue([assignment('a1'), assignment('a9', 'c2')]);
    act(() => result.current.setSelectedCourses(['c2']));

    await waitFor(() => expect(result.current.selectedAssignments).toEqual(['a1']));
  });

  /**
   * The bug the extraction found. Widening the scope changes this query's key, so the list is
   * briefly empty while the new one loads. Pruning against that empty list threw away a filter
   * the user had just set, on a course change that did not invalidate it at all.
   */
  it('keeps the assignment filter when a course is added to the selection', async () => {
    fetchAssignmentsForCourses.mockResolvedValue([assignment('a1')]);
    const { result } = render();

    act(() => result.current.setSelectedCourses(['c1']));
    await waitFor(() => expect(result.current.assignmentOptions).toHaveLength(1));
    act(() => result.current.setSelectedAssignments(['a1']));

    fetchAssignmentsForCourses.mockResolvedValue([assignment('a1'), assignment('a9', 'c2')]);
    act(() => result.current.setSelectedCourses(['c1', 'c2']));

    await waitFor(() => expect(result.current.assignmentOptions).toHaveLength(2));
    expect(result.current.selectedAssignments).toEqual(['a1']);
  });

  it('drops a selected problem when its assignment goes away', async () => {
    fetchAssignmentsForCourses.mockResolvedValue([assignment('a1')]);
    fetchProblemsForAssignments.mockResolvedValue([problem('p1')]);
    const { result } = render();

    act(() => result.current.setSelectedCourses(['c1']));
    await waitFor(() => expect(result.current.assignmentOptions).toHaveLength(1));
    act(() => result.current.setSelectedAssignments(['a1']));
    await waitFor(() => expect(result.current.problemOptions).toHaveLength(1));
    act(() => result.current.setSelectedProblems(['p1']));

    fetchProblemsForAssignments.mockResolvedValue([problem('p9')]);
    act(() => result.current.setSelectedAssignments(['a2']));

    await waitFor(() => expect(result.current.selectedProblems).toEqual([]));
  });

  /**
   * Clearing the course selection empties the assignment list, and an empty list must prune
   * too. The obvious "only prune when the list has something in it" shortcut would leave the
   * selection stranded here, which is the state that filters the table down to nothing.
   */
  it('clears the assignment selection when the course selection is emptied', async () => {
    fetchAssignmentsForCourses.mockResolvedValue([assignment('a1')]);
    const { result } = render();

    act(() => result.current.setSelectedCourses(['c1']));
    await waitFor(() => expect(result.current.assignmentOptions).toHaveLength(1));
    act(() => result.current.setSelectedAssignments(['a1']));

    act(() => result.current.setSelectedCourses([]));

    await waitFor(() => expect(result.current.selectedAssignments).toEqual([]));
  });
});

describe('the option lists', () => {
  it('sorts assignments and problems by what the user reads', async () => {
    fetchAssignmentsForCourses.mockResolvedValue([
      { ...assignment('a1'), title: 'Zeta' },
      { ...assignment('a2'), title: 'Alpha' },
    ]);
    const { result } = render();

    act(() => result.current.setSelectedCourses(['c1']));

    await waitFor(() => expect(result.current.assignmentOptions).toHaveLength(2));
    expect(result.current.assignmentOptions.map((o) => o.label)).toEqual(['Alpha', 'Zeta']);
  });

  it('labels a problem by its id when it has no title', async () => {
    fetchAssignmentsForCourses.mockResolvedValue([assignment('a1')]);
    fetchProblemsForAssignments.mockResolvedValue([{ ...problem('p1'), title: '' }]);
    const { result } = render();

    act(() => result.current.setSelectedCourses(['c1']));
    await waitFor(() => expect(result.current.assignmentOptions).toHaveLength(1));
    act(() => result.current.setSelectedAssignments(['a1']));

    await waitFor(() => expect(result.current.problemOptions).toEqual([{ id: 'p1', label: 'p1' }]));
  });
});

describe('when a list cannot be loaded', () => {
  it('says so rather than showing an empty picker', async () => {
    fetchCourseList.mockRejectedValue(new Error('nope'));
    render();

    await waitFor(() => expect(errorToast).toHaveBeenCalledWith(expect.stringMatching(/courses/)));
  });

  it('names the list that failed', async () => {
    fetchAssignmentsForCourses.mockRejectedValue(new Error('nope'));
    const { result } = render();

    act(() => result.current.setSelectedCourses(['c1']));

    await waitFor(() =>
      expect(errorToast).toHaveBeenCalledWith(expect.stringMatching(/assignments/)),
    );
    expect(errorToast).not.toHaveBeenCalledWith(expect.stringMatching(/courses/));
  });
});

describe('clearing', () => {
  it('drops all three selections at once', async () => {
    fetchAssignmentsForCourses.mockResolvedValue([assignment('a1')]);
    const { result } = render();

    act(() => result.current.setSelectedCourses(['c1']));
    await waitFor(() => expect(result.current.assignmentOptions).toHaveLength(1));
    act(() => result.current.setSelectedAssignments(['a1']));
    expect(result.current.anyScopeActive).toBe(true);

    act(() => result.current.clearScope());

    await waitFor(() => expect(result.current.anyScopeActive).toBe(false));
    expect(result.current.selectedCourses).toEqual([]);
    expect(result.current.selectedAssignments).toEqual([]);
  });
});
