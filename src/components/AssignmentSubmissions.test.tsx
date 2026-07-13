/** @vitest-environment jsdom */

import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

// ProblemWorkspace stub surfaces the grade + comment flows: a field bound to
// gradeInput (onGradeInputChange) and Save; the current grade + any grade error; a
// comment field (onCommentTextChange) with Save; and the seeded comments each with a
// delete button (onDeleteComment).
vi.mock('@/components/assignments/ProblemWorkspace', () => ({
  default: ({
    onGradeInputChange,
    onSaveGrade,
    gradeInput,
    gradeError,
    currentGrade,
    commentText,
    onCommentTextChange,
    onSaveComment,
    onDeleteComment,
    comments,
  }: {
    onGradeInputChange: (value: string) => void;
    onSaveGrade: () => void;
    gradeInput: string;
    gradeError?: string | null;
    currentGrade?: number | null;
    commentText?: string;
    onCommentTextChange: (value: string) => void;
    onSaveComment: () => void;
    onDeleteComment: (commentId: string) => void;
    comments?: Array<{ id: string; content?: string }>;
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
      <span data-testid="current-grade">{String(currentGrade)}</span>
      {gradeError ? <span data-testid="grade-error">{gradeError}</span> : null}
      <input
        data-testid="comment-input"
        value={commentText ?? ''}
        onChange={(e) => onCommentTextChange(e.target.value)}
      />
      <button type="button" onClick={onSaveComment}>
        Save Comment
      </button>
      <ul data-testid="comments">
        {(comments ?? []).map((c) => (
          <li key={c.id}>
            {c.content}
            <button type="button" onClick={() => onDeleteComment(c.id)}>
              del-{c.id}
            </button>
          </li>
        ))}
      </ul>
    </div>
  ),
}));

vi.mock('./StudentNavigator', () => ({
  default: ({
    students: navStudents,
    onPrev,
    onNext,
    onSelectStudent,
    gradeStatuses,
    selectedIndex,
  }: {
    students: Array<{ id: string }>;
    onPrev: () => void;
    onNext: () => void;
    onSelectStudent: (id: string) => void;
    gradeStatuses?: Record<string, boolean>;
    selectedIndex: number;
  }) => (
    <div data-testid="student-navigator">
      <span data-testid="selected-index">{selectedIndex}</span>
      <button type="button" onClick={onPrev}>
        prev-student
      </button>
      <button type="button" onClick={onNext}>
        next-student
      </button>
      {navStudents.map((s) => (
        <button key={s.id} type="button" onClick={() => onSelectStudent(s.id)}>
          pick-{s.id}
        </button>
      ))}
      <span data-testid="grade-status">{String(gradeStatuses?.s1)}</span>
    </div>
  ),
}));
vi.mock('./JffViewerDialog', () => ({ default: () => null }));
vi.mock('@/components/dialogs/RegexViewerDialog', () => ({ RegexViewerDialog: () => null }));
vi.mock('@/components/dialogs/CfgViewerDialog', () => ({ CfgViewerDialog: () => null }));

const students = [{ id: 's1', firstName: 'Ada', lastName: 'Lovelace' }];

const emptyReviewData = { submissions: {}, comments: [], problemGrades: {} };

// Simple URL router over fetch. Each route returns a fresh response object.
type FetchResult = {
  ok: boolean;
  status?: number;
  json: () => Promise<unknown>;
  text?: () => Promise<string>;
};
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
        '/api/courses/c1/assignments/a1/review-data/s1',
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
      // The grade POST now goes through apiClient, which reads res.text().
      '/problems/p1/grade/s1': () => ({
        ok: true,
        json: async () => ({ ok: true }),
        text: async () => JSON.stringify({ ok: true }),
      }),
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
        '/api/courses/c1/assignments/a1/problems/p1/grade/s1',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    // Invalidation refetches review-data (a second call).
    await waitFor(() => expect(reviewCalls).toBe(2));
    expect(toastSuccess).toHaveBeenCalled();
  });
});

// A review-data payload with an existing grade and comment on p1.
const seededReviewData = {
  submissions: {},
  comments: [{ id: 'c1', content: 'Looks good', problemId: 'p1' }],
  problemGrades: { p1: { grade: 8, feedback: null } },
};

const baseRoutes = () => ({
  '/students': () => ({ ok: true, json: async () => students }),
  'problem-grades/summary': () => ({ ok: true, json: async () => ({}) }),
  '/review-data/': () => ({ ok: true, json: async () => emptyReviewData }),
});

const gradeEndpointCalled = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls.some(
    ([u, init]) =>
      String(u).includes('/grade/') && (init as RequestInit | undefined)?.method === 'POST',
  );

describe('AssignmentSubmissions — grade validation', () => {
  // Render, then wait for review-data to seed (current grade resolves) so the seeding
  // effect can't clobber the value we type next.
  const setup = async (routes = baseRoutes()) => {
    const fetchMock = routeFetch(routes);
    vi.stubGlobal('fetch', fetchMock);
    renderWithClient(<AssignmentSubmissions {...baseProps} />);
    await screen.findByTestId('problem-workspace');
    await waitFor(() => expect(screen.getByTestId('current-grade')).toHaveTextContent('null'));
    return fetchMock;
  };

  it('rejects a non-numeric grade without POSTing', async () => {
    const fetchMock = await setup();
    fireEvent.change(screen.getByTestId('grade-input'), { target: { value: 'abc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Grade' }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Grade must be a number'));
    expect(gradeEndpointCalled(fetchMock)).toBe(false);
  });

  it('rejects a negative grade without POSTing', async () => {
    const fetchMock = await setup();
    fireEvent.change(screen.getByTestId('grade-input'), { target: { value: '-5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Grade' }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Grade must be at least 0'));
    expect(gradeEndpointCalled(fetchMock)).toBe(false);
  });

  it('rejects a grade above the problem max without POSTing', async () => {
    const fetchMock = await setup();
    // baseProps p1 has maxPoints 10.
    fireEvent.change(screen.getByTestId('grade-input'), { target: { value: '20' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Grade' }));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('Grade must be between 0 and 10'),
    );
    expect(gradeEndpointCalled(fetchMock)).toBe(false);
  });

  it('blocks grading on an archived course', async () => {
    const fetchMock = routeFetch(baseRoutes());
    vi.stubGlobal('fetch', fetchMock);
    renderWithClient(<AssignmentSubmissions {...baseProps} courseIsArchived />);
    await screen.findByTestId('problem-workspace');
    fireEvent.change(screen.getByTestId('grade-input'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Grade' }));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('Course is archived; grades cannot be edited.'),
    );
    expect(gradeEndpointCalled(fetchMock)).toBe(false);
  });
});

describe('AssignmentSubmissions — comments', () => {
  it('posts a new comment and toasts success', async () => {
    const fetchMock = routeFetch({
      ...baseRoutes(),
      '/comments': () => ({
        ok: true,
        status: 200,
        json: async () => ({ id: 'c-new', content: 'Great', problemId: 'p1' }),
        text: async () => JSON.stringify({ id: 'c-new', content: 'Great', problemId: 'p1' }),
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWithClient(<AssignmentSubmissions {...baseProps} />);
    await screen.findByTestId('problem-workspace');

    fireEvent.change(screen.getByTestId('comment-input'), { target: { value: 'Great' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Comment' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/comments',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    const call = fetchMock.mock.calls.find(
      ([u, init]) => String(u) === '/api/comments' && (init as RequestInit)?.method === 'POST',
    );
    expect(JSON.parse(String((call![1] as RequestInit).body))).toMatchObject({
      content: 'Great',
      assignmentId: 'a1',
      problemId: 'p1',
      studentId: 's1',
    });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Comment saved successfully'));
  });

  it('deletes an existing comment and toasts success', async () => {
    const fetchMock = routeFetch({
      '/students': () => ({ ok: true, json: async () => students }),
      'problem-grades/summary': () => ({ ok: true, json: async () => ({}) }),
      '/review-data/': () => ({ ok: true, json: async () => seededReviewData }),
      '/comments': () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '{}' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWithClient(<AssignmentSubmissions {...baseProps} />);

    // The seeded comment renders with its delete button.
    fireEvent.click(await screen.findByRole('button', { name: 'del-c1' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/comments?commentId=c1',
        expect.objectContaining({ method: 'DELETE' }),
      ),
    );
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Comment deleted successfully'));
  });
});

describe('AssignmentSubmissions — state seeding & edges', () => {
  it('seeds the current grade from review-data', async () => {
    const fetchMock = routeFetch({
      '/students': () => ({ ok: true, json: async () => students }),
      'problem-grades/summary': () => ({ ok: true, json: async () => ({}) }),
      '/review-data/': () => ({ ok: true, json: async () => seededReviewData }),
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWithClient(<AssignmentSubmissions {...baseProps} />);
    await waitFor(() => expect(screen.getByTestId('current-grade')).toHaveTextContent('8'));
  });

  it('shows an empty-state message when the assignment has no problems', async () => {
    const fetchMock = routeFetch(baseRoutes());
    vi.stubGlobal('fetch', fetchMock);
    renderWithClient(<AssignmentSubmissions {...baseProps} problems={[]} />);
    expect(
      await screen.findByText('No problems have been added to this assignment yet.'),
    ).toBeInTheDocument();
  });

  it('toasts when the students read fails', async () => {
    const fetchMock = routeFetch({
      '/students': () => ({ ok: false, status: 500, json: async () => ({ error: 'nope' }) }),
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWithClient(<AssignmentSubmissions {...baseProps} />);
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Failed to load students'));
  });

  it('treats a 403 review-data response as an empty payload without erroring', async () => {
    const fetchMock = routeFetch({
      '/students': () => ({ ok: true, json: async () => students }),
      'problem-grades/summary': () => ({ ok: true, json: async () => ({}) }),
      '/review-data/': () => ({ ok: false, status: 403, json: async () => ({}) }),
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWithClient(<AssignmentSubmissions {...baseProps} />);

    // The workspace still renders (empty state), and no error toast fires.
    await screen.findByTestId('problem-workspace');
    expect(toastError).not.toHaveBeenCalledWith('Failed to load review data');
  });

  it('toasts when the review-data read fails with a non-auth error', async () => {
    const fetchMock = routeFetch({
      '/students': () => ({ ok: true, json: async () => students }),
      'problem-grades/summary': () => ({ ok: true, json: async () => ({}) }),
      '/review-data/': () => ({ ok: false, status: 500, json: async () => ({ error: 'boom' }) }),
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWithClient(<AssignmentSubmissions {...baseProps} />);
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Failed to load review data'));
  });
});

describe('AssignmentSubmissions — group problem filtering', () => {
  // p1 is assignment-level (unmapped); p2 belongs to group g1.
  const groupProps = {
    ...baseProps,
    problems: [
      { id: 'p1', title: 'Assignment Level', type: 'FA', maxPoints: 10 },
      { id: 'p2', title: 'Group Only', type: 'FA', maxPoints: 10 },
    ],
    assignmentIsGroup: true,
    groups: [{ id: 'g1', name: 'G1' }],
    groupProblemsMap: { g1: ['p2'] },
  };

  const renderWithMemberships = (memberships: Array<{ userId: string; groupId: string }>) => {
    const fetchMock = routeFetch({
      '/students': () => ({ ok: true, json: async () => students }),
      'problem-grades/summary': () => ({ ok: true, json: async () => ({}) }),
      '/group-memberships': () => ({ ok: true, json: async () => ({ memberships }) }),
      '/review-data/': () => ({ ok: true, json: async () => emptyReviewData }),
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWithClient(<AssignmentSubmissions {...groupProps} />);
  };

  it('shows assignment-level and the student group’s problems for a group member', async () => {
    renderWithMemberships([{ userId: 's1', groupId: 'g1' }]);
    const list = await screen.findByTestId('problem-list');
    await waitFor(() => expect(within(list).getByText('Group Only')).toBeInTheDocument());
    expect(within(list).getByText('Assignment Level')).toBeInTheDocument();
  });

  it('shows only assignment-level problems for a student in no group', async () => {
    renderWithMemberships([]); // s1 is not a member of g1
    const list = await screen.findByTestId('problem-list');
    await waitFor(() => expect(within(list).getByText('Assignment Level')).toBeInTheDocument());
    expect(within(list).queryByText('Group Only')).not.toBeInTheDocument();
  });
});

describe('AssignmentSubmissions — student navigation', () => {
  // Sorted by last name: Lovelace (s1) index 0, Turing (s2) index 1.
  const twoStudents = [
    { id: 's1', firstName: 'Ada', lastName: 'Lovelace' },
    { id: 's2', firstName: 'Alan', lastName: 'Turing' },
  ];

  const renderTwo = () => {
    const fetchMock = routeFetch({
      '/students': () => ({ ok: true, json: async () => twoStudents }),
      'problem-grades/summary': () => ({ ok: true, json: async () => ({}) }),
      '/review-data/': () => ({ ok: true, json: async () => emptyReviewData }),
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWithClient(<AssignmentSubmissions {...baseProps} />);
  };

  it('advances and wraps with next/prev', async () => {
    renderTwo();
    const idx = await screen.findByTestId('selected-index');
    await waitFor(() => expect(idx).toHaveTextContent('0'));

    fireEvent.click(screen.getByRole('button', { name: 'next-student' }));
    expect(idx).toHaveTextContent('1');

    fireEvent.click(screen.getByRole('button', { name: 'next-student' })); // wraps to first
    expect(idx).toHaveTextContent('0');

    fireEvent.click(screen.getByRole('button', { name: 'prev-student' })); // wraps to last
    expect(idx).toHaveTextContent('1');
  });

  it('selects a specific student by id', async () => {
    renderTwo();
    const idx = await screen.findByTestId('selected-index');
    await waitFor(() => expect(idx).toHaveTextContent('0'));

    fireEvent.click(screen.getByRole('button', { name: 'pick-s2' }));
    expect(idx).toHaveTextContent('1');
  });
});
