/** @vitest-environment jsdom */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AssignmentSubmissions from './AssignmentSubmissions';

// Render with a fresh QueryClient per test (retry off, no lingering cache) so each
// read starts clean.
const renderWithClient = (ui: React.ReactElement) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
};

const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());

vi.mock('@/lib/toast', () => ({
  showToast: { success: toastSuccess, error: toastError },
}));

// Selected student is driven from the URL (?studentId=s1).
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams('studentId=s1'),
}));

vi.mock('@/lib/useEmptyStringSymbol', () => ({
  useEmptyStringSymbol: () => '∅',
}));

// Rerun utils aren't exercised here; keep them inert.
vi.mock('@/app/utils/rerunSubmission', () => ({ rerunSubmission: vi.fn() }));
vi.mock('@/app/utils/rerunVisibleSubmissions', () => ({ rerunVisibleSubmissions: vi.fn() }));

// ProblemListCard renders the problem titles it receives.
vi.mock('@/components/assignments/ProblemListCard', () => ({
  ProblemListCard: ({ problems }: { problems: Array<{ id: string; title: string }> }) => (
    <ul data-testid="problem-list">
      {problems.map((p) => (
        <li key={p.id}>{p.title}</li>
      ))}
    </ul>
  ),
}));

// ProblemWorkspace stub exposes the grade flow: a field bound to gradeInput
// (onGradeInputChange) and a button to save it (onSaveGrade).
vi.mock('@/components/assignments/ProblemWorkspace', () => ({
  default: ({
    onGradeInputChange,
    onSaveGrade,
    gradeInput,
  }: {
    onGradeInputChange: (value: string) => void;
    onSaveGrade: () => void;
    gradeInput: string;
  }) => (
    <div data-testid="problem-workspace">
      <input
        data-testid="grade-input"
        value={gradeInput}
        onChange={(e) => onGradeInputChange(e.target.value)}
      />
      <button type="button" onClick={onSaveGrade}>
        Save Grade
      </button>
    </div>
  ),
}));

vi.mock('./StudentNavigator', () => ({ default: () => <div data-testid="student-navigator" /> }));
vi.mock('./JffViewerDialog', () => ({ default: () => null }));
vi.mock('@/components/dialogs/RegexViewerDialog', () => ({ RegexViewerDialog: () => null }));
vi.mock('@/components/dialogs/CfgViewerDialog', () => ({ CfgViewerDialog: () => null }));

const students = [{ id: 's1', firstName: 'Ada', lastName: 'Lovelace' }];

const emptyReviewData = { submissions: {}, comments: [], problemGrades: {} };

// Simple URL router over fetch. Each route returns a fresh response object.
type FetchResult = { ok: boolean; status?: number; json: () => Promise<unknown> };
const routeFetch = (routes: Record<string, () => FetchResult>) =>
  vi.fn((url: string) => {
    const key = Object.keys(routes).find((r) => url.includes(r));
    if (!key) throw new Error(`Unexpected fetch: ${url}`);
    return Promise.resolve(routes[key]());
  });

const baseProps = {
  courseIsArchived: false,
  courseId: 'c1',
  assignmentId: 'a1',
  maxAssignmentGrade: 100,
  assignmentDueDate: null,
  problems: [{ id: 'p1', title: 'Problem One', type: 'FA', maxPoints: 10 }],
};

describe('AssignmentSubmissions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  it('fetches students and review-data for the URL-selected student, then renders', async () => {
    const fetchMock = routeFetch({
      '/students': () => ({ ok: true, json: async () => students }),
      'problem-grades/summary': () => ({ ok: true, json: async () => ({}) }),
      '/review-data/': () => ({ ok: true, json: async () => emptyReviewData }),
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithClient(<AssignmentSubmissions {...baseProps} />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/courses/c1/students');
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/courses/c1/a1/review-data/s1',
        expect.objectContaining({ signal: expect.anything() }),
      );
    });

    // The seeded problem renders through the ProblemListCard stub.
    await waitFor(() => {
      expect(screen.getByText('Problem One')).toBeInTheDocument();
    });
    expect(screen.getByTestId('problem-workspace')).toBeInTheDocument();
  });

  it('uses the consolidated group-memberships endpoint once and no per-group calls', async () => {
    const fetchMock = routeFetch({
      '/students': () => ({ ok: true, json: async () => students }),
      'problem-grades/summary': () => ({ ok: true, json: async () => ({}) }),
      '/group-memberships': () => ({
        ok: true,
        json: async () => ({ memberships: [{ userId: 's1', groupId: 'g1' }] }),
      }),
      '/review-data/': () => ({ ok: true, json: async () => emptyReviewData }),
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithClient(
      <AssignmentSubmissions
        {...baseProps}
        assignmentIsGroup
        groups={[{ id: 'g1', name: 'Group 1' }]}
        groupProblemsMap={{ g1: ['p1'] }}
      />,
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/courses/c1/group-memberships');
    });

    const calledUrls = fetchMock.mock.calls.map((c) => c[0] as string);
    // Consolidated endpoint hit exactly once...
    expect(calledUrls.filter((u) => u.includes('/group-memberships')).length).toBe(1);
    // ...and the old per-group members endpoint is never called.
    expect(calledUrls.some((u) => /\/groups\/[^/]+\/members/.test(u))).toBe(false);
  });

  it('posts a single-problem grade then re-fetches review-data (invalidation)', async () => {
    let reviewCalls = 0;
    const fetchMock = routeFetch({
      '/students': () => ({ ok: true, json: async () => students }),
      'problem-grades/summary': () => ({ ok: true, json: async () => ({}) }),
      // Order matters: the single-problem grade route contains "/problems/" and
      // must be matched before the broad "/review-data/" fallback.
      '/problems/p1/grade/s1': () => ({ ok: true, json: async () => ({ ok: true }) }),
      '/review-data/': () => {
        reviewCalls += 1;
        return { ok: true, json: async () => emptyReviewData };
      },
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithClient(<AssignmentSubmissions {...baseProps} />);

    await waitFor(() => expect(reviewCalls).toBe(1));

    fireEvent.change(screen.getByTestId('grade-input'), { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Grade' }));

    // The per-problem POST fires.
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/courses/c1/a1/problems/p1/grade/s1',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    // Invalidation refetches review-data (a second call).
    await waitFor(() => expect(reviewCalls).toBe(2));
    expect(toastSuccess).toHaveBeenCalled();
  });
});
