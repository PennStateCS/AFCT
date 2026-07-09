/** @vitest-environment jsdom */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import StudentAssignmentPage from './StudentAssignmentView';
import type { AssignmentWithDetails } from '@/lib/assignment-details';

// Render with a fresh QueryClient per test (retry off, no lingering cache) so each
// assignment/context query starts clean.
const renderWithClient = (ui: React.ReactElement) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
};

const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());

vi.mock('@/lib/toast', () => ({
  showToast: { success: toastSuccess, error: toastError },
}));

vi.mock('next-auth/react', () => ({
  useSession: () => ({
    data: { user: { id: 'u1', isAdmin: false } },
    status: 'authenticated',
  }),
}));

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'c1', aid: 'a1' }),
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => ({ get: () => null }),
}));

vi.mock('@/hooks/use-effective-timezone', () => ({
  useEffectiveTimezone: () => ({ timezone: 'UTC' }),
}));

vi.mock('@/lib/useEmptyStringSymbol', () => ({
  useEmptyStringSymbol: () => '∅',
}));

// Lightweight stubs for the heavy children. ProblemListCard just renders the
// problem titles it receives so we can assert the problem shows up.
vi.mock('@/components/assignments/ProblemListCard', () => ({
  ProblemListCard: ({ problems }: { problems: Array<{ id: string; title: string }> }) => (
    <ul data-testid="problem-list">
      {problems.map((p) => (
        <li key={p.id}>{p.title}</li>
      ))}
    </ul>
  ),
}));

// ProblemWorkspace stub exposes the comment flow: a field to set the comment text
// (onCommentTextChange) and a button to save it (onSaveComment).
vi.mock('@/components/assignments/ProblemWorkspace', () => ({
  default: ({
    onSaveComment,
    onCommentTextChange,
    commentText,
  }: {
    onSaveComment: () => void;
    onCommentTextChange: (text: string) => void;
    commentText: string;
  }) => (
    <div data-testid="problem-workspace">
      <input
        data-testid="comment-input"
        value={commentText}
        onChange={(e) => onCommentTextChange(e.target.value)}
      />
      <button type="button" onClick={onSaveComment}>
        Save Comment
      </button>
    </div>
  ),
}));

vi.mock('@/components/JffViewerDialog', () => ({ default: () => null }));
vi.mock('@/components/dialogs/RegexViewerDialog', () => ({ RegexViewerDialog: () => null }));
vi.mock('@/components/dialogs/CfgViewerDialog', () => ({ CfgViewerDialog: () => null }));

const buildAssignment = (): AssignmentWithDetails =>
  ({
    id: 'a1',
    title: 'Regex Basics',
    courseId: 'c1',
    isPublished: true,
    dueDate: new Date('2026-01-10T00:00:00.000Z'),
    maxPoints: 100,
    allowLateSubmissions: false,
    lateCutoff: null,
    course: { id: 'c1', name: 'Automata', code: 'CS101' },
    problems: [
      {
        problem: {
          id: 'p1',
          title: 'Problem One',
          type: 'FA',
          maxPoints: 10,
          maxSubmissions: 3,
          autograderEnabled: true,
        },
        maxPoints: 10,
        maxSubmissions: 3,
        autograderEnabled: true,
      },
    ],
  }) as unknown as AssignmentWithDetails;

const emptyContext = {
  assignmentGrade: null,
  problemGrades: {},
  submissionCount: 0,
  submissionsByProblem: {},
  commentsByProblem: {},
};

// Simple URL router over fetch so tests only care about the endpoint hit.
type FetchResult = { ok: boolean; json: () => Promise<unknown> };
const routeFetch = (routes: Record<string, () => FetchResult>) =>
  vi.fn((url: string) => {
    const key = Object.keys(routes).find((r) => url.includes(r));
    if (!key) throw new Error(`Unexpected fetch: ${url}`);
    return Promise.resolve(routes[key]());
  });

describe('StudentAssignmentPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  it('renders the seeded assignment, skips the assignment fetch, and pulls student-context', async () => {
    const fetchMock = routeFetch({
      'student-context': () => ({ ok: true, json: async () => emptyContext }),
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithClient(<StudentAssignmentPage initialAssignment={buildAssignment()} />);

    // Title comes from the seeded initialAssignment (initialData).
    expect(screen.getAllByText('Regex Basics').length).toBeGreaterThan(0);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/courses/c1/assignments/a1/student-context');
    });

    // The assignment shell was seeded, so no GET for the assignment itself.
    const calledUrls = fetchMock.mock.calls.map((c) => c[0] as string);
    expect(calledUrls.some((u) => u.startsWith('/api/courses/c1/assignments/a1?'))).toBe(false);
  });

  it('renders the problem from initialAssignment while student-context is empty', async () => {
    const fetchMock = routeFetch({
      'student-context': () => ({ ok: true, json: async () => emptyContext }),
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithClient(<StudentAssignmentPage initialAssignment={buildAssignment()} />);

    await waitFor(() => {
      // ProblemListCard stub renders the (truncated) problem title.
      expect(screen.getByText('Problem One')).toBeInTheDocument();
    });
    expect(screen.getByTestId('problem-workspace')).toBeInTheDocument();
  });

  it('posts a comment then refetches student-context on success', async () => {
    let contextCalls = 0;
    const fetchMock = routeFetch({
      'student-context': () => {
        contextCalls += 1;
        return { ok: true, json: async () => emptyContext };
      },
      '/comments': () => ({ ok: true, json: async () => ({ id: 'cm1' }) }),
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithClient(<StudentAssignmentPage initialAssignment={buildAssignment()} />);

    // Wait for the initial student-context fetch to settle.
    await waitFor(() => expect(contextCalls).toBe(1));

    // Set non-empty comment text (handleSubmitComment early-returns on empty).
    fireEvent.change(screen.getByTestId('comment-input'), { target: { value: 'Nice problem' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Comment' }));

    // POST fires against the selected problem's comments endpoint.
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/problems/p1/comments',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    // Invalidation refetches student-context (a second call).
    await waitFor(() => expect(contextCalls).toBe(2));
    expect(toastSuccess).toHaveBeenCalledWith('Comment added successfully!');
  });

  it('surfaces a toast when the student-context fetch fails', async () => {
    const fetchMock = routeFetch({
      'student-context': () => ({ ok: false, json: async () => ({}) }),
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithClient(<StudentAssignmentPage initialAssignment={buildAssignment()} />);

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith('Failed to load assignment context');
    });
  });
});
