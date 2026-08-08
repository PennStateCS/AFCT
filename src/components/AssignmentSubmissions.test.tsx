/** @vitest-environment jsdom */

import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AssignmentSubmissions from './AssignmentSubmissions';

// Render with a fresh QueryClient per test (retry off, no lingering cache) so each
// read starts clean.
const renderWithClient = (ui: React.ReactElement) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return { ...render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>), client };
};

import { toastMock } from '@/test/mocks/toast';

vi.mock('@/lib/toast', () => import('@/test/mocks/toast').then((m) => m.toastModuleMock));
const toastSuccess = toastMock.success;
const toastError = toastMock.error;

// Selected student is driven from the URL (?studentId=s1). useRouter returns a STABLE
// object (like Next's real hook) so callbacks memoized on `router` don't churn every
// render.
const routerMock = vi.hoisted(() => ({ replace: vi.fn() }));
const urlQuery = vi.hoisted(() => ({ current: 'studentId=s1' }));
vi.mock('next/navigation', () => ({
  useRouter: () => routerMock,
  useSearchParams: () => new URLSearchParams(urlQuery.current),
}));

vi.mock('@/hooks/use-empty-string-symbol', () => ({
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
    submissions,
    commentAudience,
    gradeAudience,
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
    submissions?: Array<{ id: string }>;
    commentAudience?: {
      target: 'student' | 'group';
      onTargetChange: (t: 'student' | 'group') => void;
    } | null;
    gradeAudience?: { target: 'student' | 'group' } | null;
  }) => (
    <div data-testid="problem-workspace">
      <span data-testid="submission-count">{(submissions ?? []).length}</span>
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
      {/* The real workspace renders a segmented control for this; the stub just exposes
          the audience so a test can read the default and switch it. */}
      <span data-testid="comment-audience">{commentAudience?.target ?? 'none'}</span>
      <span data-testid="grade-audience">{gradeAudience?.target ?? 'none'}</span>
      {commentAudience ? (
        <button type="button" onClick={() => commentAudience.onTargetChange('student')}>
          Send to student only
        </button>
      ) : null}
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

/** The selected student submits this assignment with Group 3, alongside s2. */
const groupReviewData = {
  ...emptyReviewData,
  isGroupAssignment: true,
  isGroup: true,
  group: { id: 'g1', name: 'Group 3' },
  groupMembers: [{ id: 's2', firstName: 'Grace', lastName: 'Hopper' }],
};

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
      // The submissions view requests dropped students too (they show, labeled).
      expect(fetchMock).toHaveBeenCalledWith('/api/courses/c1/students?includeDropped=1');
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

  // The graded-or-not dot beside each student is updated optimistically on save. Refetching
  // the summary would overwrite that with a server answer computed before the write landed,
  // so the dot would flick back to "missing grades" for a student who was just fully graded.
  // The code says this is deliberate; nothing checked it until now.
  it('does not refetch the grade summary after a save', async () => {
    const invalidate = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
    const fetchMock = routeFetch({
      '/students': () => ({ ok: true, json: async () => students }),
      'problem-grades/summary': () => ({ ok: true, json: async () => ({}) }),
      '/problems/p1/grade/s1': () => ({
        ok: true,
        json: async () => ({ ok: true }),
        text: async () => JSON.stringify({ ok: true }),
      }),
      '/review-data/': () => ({ ok: true, json: async () => emptyReviewData }),
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithClient(<AssignmentSubmissions {...baseProps} />);
    await screen.findByTestId('problem-workspace');
    invalidate.mockClear();

    fireEvent.change(screen.getByTestId('grade-input'), { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Grade' }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    const keys = invalidate.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
    expect(keys.some((k) => k?.includes('review-data'))).toBe(true);
    expect(keys.some((k) => k?.includes('summary'))).toBe(false);
    invalidate.mockRestore();
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
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Enter the grade as a number.'));
    expect(gradeEndpointCalled(fetchMock)).toBe(false);
  });

  it('rejects a negative grade without POSTing', async () => {
    const fetchMock = await setup();
    fireEvent.change(screen.getByTestId('grade-input'), { target: { value: '-5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Grade' }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Enter a grade of at least 0.'));
    expect(gradeEndpointCalled(fetchMock)).toBe(false);
  });

  it('rejects a grade above the problem max without POSTing', async () => {
    const fetchMock = await setup();
    // baseProps p1 has maxPoints 10.
    fireEvent.change(screen.getByTestId('grade-input'), { target: { value: '20' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Grade' }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Enter a grade between 0 and 10.'));
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
      expect(toastError).toHaveBeenCalledWith(
        'This course is archived, so grades cannot be edited. Unarchive the course to make changes.',
      ),
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
    const call = (fetchMock.mock.calls as unknown as [string, RequestInit][]).find(
      ([u, init]) => String(u) === '/api/comments' && init?.method === 'POST',
    );
    expect(JSON.parse(String(call![1].body))).toMatchObject({
      content: 'Great',
      assignmentId: 'a1',
      problemId: 'p1',
      studentId: 's1',
    });
    await waitFor(() => expect(toastMock.saved).toHaveBeenCalledWith('Comment'));
  });

  it('deletes an existing comment and toasts success', async () => {
    const fetchMock = routeFetch({
      '/students': () => ({ ok: true, json: async () => students }),
      'problem-grades/summary': () => ({ ok: true, json: async () => ({}) }),
      '/review-data/': () => ({ ok: true, json: async () => seededReviewData }),
      '/comments': () => ({
        ok: true,
        status: 200,
        json: async () => ({}),
        text: async () => '{}',
      }),
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
    await waitFor(() => expect(toastMock.deleted).toHaveBeenCalledWith('Comment'));
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
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        'Could not load the student list. Refresh the page to try again.',
      ),
    );
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
    expect(toastError).not.toHaveBeenCalledWith(
      'Could not load this submission. Refresh the page to try again.',
    );
  });

  it('toasts when the review-data read fails with a non-auth error', async () => {
    const fetchMock = routeFetch({
      '/students': () => ({ ok: true, json: async () => students }),
      'problem-grades/summary': () => ({ ok: true, json: async () => ({}) }),
      '/review-data/': () => ({ ok: false, status: 500, json: async () => ({ error: 'boom' }) }),
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWithClient(<AssignmentSubmissions {...baseProps} />);
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        'Could not load this submission. Refresh the page to try again.',
      ),
    );
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

  // Selecting a student used to call router.replace, which on a dynamic server component
  // route fetches a fresh RSC payload and re-runs the page's database queries. The URL
  // still has to change; it just must not cost a round trip to do it.
  it('syncs the selected student into the URL without navigating', async () => {
    const replaceState = vi.spyOn(window.history, 'replaceState');
    renderTwo();
    const idx = await screen.findByTestId('selected-index');
    await waitFor(() => expect(idx).toHaveTextContent('0'));
    replaceState.mockClear();
    routerMock.replace.mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'pick-s2' }));

    await waitFor(() =>
      expect(replaceState).toHaveBeenCalledWith(null, '', expect.stringContaining('studentId=s2')),
    );
    expect(routerMock.replace).not.toHaveBeenCalled();
    replaceState.mockRestore();
  });

  it('selects a specific student by id', async () => {
    renderTwo();
    const idx = await screen.findByTestId('selected-index');
    await waitFor(() => expect(idx).toHaveTextContent('0'));

    fireEvent.click(screen.getByRole('button', { name: 'pick-s2' }));
    expect(idx).toHaveTextContent('1');
  });
});

// Safety net for the planned M12 refactor, which will turn the ~6 useState slices
// that mirror `reviewData` (submissions, comments, problemGrades, gradeInputs,
// problemGradeErrors, studentGradeStatuses) into derived state. These lock in the
// per-student seeding/derivation behavior those slices produce today.
describe('AssignmentSubmissions — reviewData seeding safety net (M12)', () => {
  const twoStudents = [
    { id: 's1', firstName: 'Ada', lastName: 'Lovelace' }, // sorted index 0
    { id: 's2', firstName: 'Alan', lastName: 'Turing' }, // sorted index 1
  ];

  it('re-seeds the grade and comments when navigating to another student', async () => {
    const fetchMock = routeFetch({
      '/students': () => ({ ok: true, json: async () => twoStudents }),
      'problem-grades/summary': () => ({ ok: true, json: async () => ({}) }),
      '/review-data/s1': () => ({
        ok: true,
        json: async () => ({
          submissions: {},
          comments: [{ id: 'cs1', content: 'S1 note', problemId: 'p1' }],
          problemGrades: { p1: { grade: 8, feedback: null } },
        }),
      }),
      '/review-data/s2': () => ({
        ok: true,
        json: async () => ({
          submissions: {},
          comments: [{ id: 'cs2', content: 'S2 note', problemId: 'p1' }],
          problemGrades: { p1: { grade: 3, feedback: null } },
        }),
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWithClient(<AssignmentSubmissions {...baseProps} />);

    // s1 is selected via the URL: its grade and comment seed the editable state.
    await waitFor(() => expect(screen.getByTestId('current-grade')).toHaveTextContent('8'));
    expect(screen.getByText('S1 note')).toBeInTheDocument();

    // Advancing to s2 must re-seed everything from s2's review-data.
    fireEvent.click(screen.getByRole('button', { name: 'next-student' }));
    await waitFor(() => expect(screen.getByTestId('current-grade')).toHaveTextContent('3'));
    expect(screen.getByText('S2 note')).toBeInTheDocument();
    expect(screen.queryByText('S1 note')).not.toBeInTheDocument();
  });

  it('seeds the selected problem’s submissions from review-data', async () => {
    const fetchMock = routeFetch({
      '/students': () => ({ ok: true, json: async () => students }),
      'problem-grades/summary': () => ({ ok: true, json: async () => ({}) }),
      '/review-data/': () => ({
        ok: true,
        json: async () => ({
          submissions: { p1: [{ id: 'sub-1' }, { id: 'sub-2' }] },
          comments: [],
          problemGrades: {},
        }),
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWithClient(<AssignmentSubmissions {...baseProps} />);
    await waitFor(() => expect(screen.getByTestId('submission-count')).toHaveTextContent('2'));
  });

  it('seeds the grade input field (string) from the review-data grade', async () => {
    const fetchMock = routeFetch({
      '/students': () => ({ ok: true, json: async () => students }),
      'problem-grades/summary': () => ({ ok: true, json: async () => ({}) }),
      '/review-data/': () => ({ ok: true, json: async () => seededReviewData }), // p1 grade 8
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWithClient(<AssignmentSubmissions {...baseProps} />);
    await waitFor(() => expect(screen.getByTestId('grade-input')).toHaveValue('8'));
  });

  it('marks the student all-graded once review-data shows every problem graded', async () => {
    const fetchMock = routeFetch({
      '/students': () => ({ ok: true, json: async () => students }),
      // Summary reports nothing, so the status must come from the review-data seeding.
      'problem-grades/summary': () => ({ ok: true, json: async () => ({}) }),
      '/review-data/': () => ({ ok: true, json: async () => seededReviewData }), // p1 graded
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWithClient(<AssignmentSubmissions {...baseProps} />);
    await waitFor(() => expect(screen.getByTestId('grade-status')).toHaveTextContent('true'));
  });

  it('keeps the student not-all-graded when a problem grade is missing', async () => {
    const fetchMock = routeFetch(baseRoutes()); // emptyReviewData -> p1 grade null
    vi.stubGlobal('fetch', fetchMock);
    renderWithClient(<AssignmentSubmissions {...baseProps} />);
    await screen.findByTestId('problem-workspace');
    await waitFor(() => expect(screen.getByTestId('grade-status')).toHaveTextContent('false'));
  });

  it('clears the grade error when the input changes', async () => {
    const fetchMock = routeFetch(baseRoutes());
    vi.stubGlobal('fetch', fetchMock);
    renderWithClient(<AssignmentSubmissions {...baseProps} />);
    await screen.findByTestId('problem-workspace');
    await waitFor(() => expect(screen.getByTestId('current-grade')).toHaveTextContent('null'));

    fireEvent.change(screen.getByTestId('grade-input'), { target: { value: 'abc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Grade' }));
    await waitFor(() =>
      expect(screen.getByTestId('grade-error')).toHaveTextContent('Enter the grade as a number.'),
    );

    // Editing the field clears the per-problem error.
    fireEvent.change(screen.getByTestId('grade-input'), { target: { value: '5' } });
    await waitFor(() => expect(screen.queryByTestId('grade-error')).not.toBeInTheDocument());
  });

  describe('problem number shortcuts', () => {
    const twoProblemProps = {
      ...baseProps,
      problems: [
        { id: 'p1', title: 'Problem One', type: 'FA', maxPoints: 10 },
        { id: 'p2', title: 'Problem Two', type: 'FA', maxPoints: 10 },
      ],
    };
    // p1 has one submission, p2 has two, so the workspace's submission-count reveals
    // which problem is selected.
    const twoProblemRoutes = () =>
      routeFetch({
        '/students': () => ({ ok: true, json: async () => students }),
        'problem-grades/summary': () => ({ ok: true, json: async () => ({}) }),
        '/review-data/': () => ({
          ok: true,
          json: async () => ({
            submissions: { p1: [{ id: 'p1-a' }], p2: [{ id: 'p2-a' }, { id: 'p2-b' }] },
            comments: [],
            problemGrades: {},
          }),
        }),
      });

    it('selects a problem when its number key is pressed', async () => {
      vi.stubGlobal('fetch', twoProblemRoutes());
      renderWithClient(<AssignmentSubmissions {...twoProblemProps} />);
      // First problem is selected by default (one submission).
      await waitFor(() => expect(screen.getByTestId('submission-count')).toHaveTextContent('1'));

      fireEvent.keyDown(window, { key: '2' });
      await waitFor(() => expect(screen.getByTestId('submission-count')).toHaveTextContent('2'));
    });

    it('ignores the number key while typing in a field', async () => {
      vi.stubGlobal('fetch', twoProblemRoutes());
      renderWithClient(<AssignmentSubmissions {...twoProblemProps} />);
      await waitFor(() => expect(screen.getByTestId('submission-count')).toHaveTextContent('1'));

      // A digit typed into an input must not switch problems.
      fireEvent.keyDown(screen.getByTestId('grade-input'), { key: '2' });
      expect(screen.getByTestId('submission-count')).toHaveTextContent('1');
    });

    it('pages students with the left/right arrow keys', async () => {
      const twoStudents = [
        { id: 's1', firstName: 'Ada', lastName: 'Lovelace' },
        { id: 's2', firstName: 'Alan', lastName: 'Turing' },
      ];
      const fetchMock = routeFetch({
        '/students': () => ({ ok: true, json: async () => twoStudents }),
        'problem-grades/summary': () => ({ ok: true, json: async () => ({}) }),
        '/review-data/': () => ({ ok: true, json: async () => emptyReviewData }),
      });
      vi.stubGlobal('fetch', fetchMock);
      renderWithClient(<AssignmentSubmissions {...baseProps} />);

      // s1 (index 0) selected via the URL.
      await waitFor(() => expect(screen.getByTestId('selected-index')).toHaveTextContent('0'));

      fireEvent.keyDown(window, { key: 'ArrowRight' });
      await waitFor(() => expect(screen.getByTestId('selected-index')).toHaveTextContent('1'));

      fireEvent.keyDown(window, { key: 'ArrowLeft' });
      await waitFor(() => expect(screen.getByTestId('selected-index')).toHaveTextContent('0'));
    });

    it('ignores the arrow keys while typing in a field', async () => {
      const twoStudents = [
        { id: 's1', firstName: 'Ada', lastName: 'Lovelace' },
        { id: 's2', firstName: 'Alan', lastName: 'Turing' },
      ];
      const fetchMock = routeFetch({
        '/students': () => ({ ok: true, json: async () => twoStudents }),
        'problem-grades/summary': () => ({ ok: true, json: async () => ({}) }),
        '/review-data/': () => ({ ok: true, json: async () => emptyReviewData }),
      });
      vi.stubGlobal('fetch', fetchMock);
      renderWithClient(<AssignmentSubmissions {...baseProps} />);
      await waitFor(() => expect(screen.getByTestId('selected-index')).toHaveTextContent('0'));

      fireEvent.keyDown(screen.getByTestId('comment-input'), { key: 'ArrowRight' });
      expect(screen.getByTestId('selected-index')).toHaveTextContent('0');
    });
  });
});

describe('AssignmentSubmissions — who a comment reaches', () => {
  const commentRoute = () => ({
    ok: true,
    status: 200,
    json: async () => ({ id: 'c-new', content: 'Great', problemId: 'p1' }),
    text: async () => JSON.stringify({ id: 'c-new', content: 'Great', problemId: 'p1' }),
  });

  const postBody = (fetchMock: ReturnType<typeof vi.fn>) => {
    const call = (fetchMock.mock.calls as unknown as [string, RequestInit][]).find(
      ([u, init]) => String(u) === '/api/comments' && init?.method === 'POST',
    );
    return JSON.parse(String(call![1].body));
  };

  const setupGroup = async () => {
    const fetchMock = routeFetch({
      ...baseRoutes(),
      '/review-data/': () => ({ ok: true, json: async () => groupReviewData }),
      '/comments': commentRoute,
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWithClient(<AssignmentSubmissions {...baseProps} />);
    await screen.findByTestId('problem-workspace');
    await waitFor(() =>
      expect(screen.getByTestId('comment-audience')).toHaveTextContent('group'),
    );
    return fetchMock;
  };

  // Agreed default: the shared submission is what staff are looking at, so the group is
  // the common case and the one that must not need a deliberate click.
  it('defaults to the whole group and posts a group comment', async () => {
    const fetchMock = await setupGroup();

    fireEvent.change(screen.getByTestId('comment-input'), { target: { value: 'Great' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Comment' }));

    await waitFor(() => expect(toastMock.saved).toHaveBeenCalledWith('Comment'));
    const body = postBody(fetchMock);
    expect(body.groupId).toBe('g1');
    // Never both: the API rejects it and a CHECK constraint refuses the row.
    expect(body.studentId).toBeUndefined();
  });

  it('posts to the one student when the target is switched', async () => {
    const fetchMock = await setupGroup();

    fireEvent.click(screen.getByRole('button', { name: 'Send to student only' }));
    fireEvent.change(screen.getByTestId('comment-input'), { target: { value: 'Great' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Comment' }));

    await waitFor(() => expect(toastMock.saved).toHaveBeenCalledWith('Comment'));
    const body = postBody(fetchMock);
    expect(body.studentId).toBe('s1');
    expect(body.groupId).toBeUndefined();
  });

  // Review data is cached per student, so without this a groupmate keeps a cached thread
  // that is missing the comment until it goes stale.
  it("refreshes each groupmate's cached thread after a group comment", async () => {
    const invalidate = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
    await setupGroup();

    fireEvent.change(screen.getByTestId('comment-input'), { target: { value: 'Great' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Comment' }));

    await waitFor(() => expect(toastMock.saved).toHaveBeenCalledWith('Comment'));
    const keys = invalidate.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
    expect(keys.some((k) => k?.includes('s2'))).toBe(true);
    invalidate.mockRestore();
  });

  it('offers no choice on an individual assignment', async () => {
    const fetchMock = routeFetch({ ...baseRoutes(), '/comments': commentRoute });
    vi.stubGlobal('fetch', fetchMock);
    renderWithClient(<AssignmentSubmissions {...baseProps} />);
    await screen.findByTestId('problem-workspace');

    expect(screen.getByTestId('comment-audience')).toHaveTextContent('none');

    fireEvent.change(screen.getByTestId('comment-input'), { target: { value: 'Great' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Comment' }));

    await waitFor(() => expect(toastMock.saved).toHaveBeenCalledWith('Comment'));
    expect(postBody(fetchMock).studentId).toBe('s1');
  });
});

/**
 * Selection is the fragile part of this component: two effects point in opposite
 * directions, one resolving the URL into an index and one writing the index back to the
 * URL. These pin the behaviour that matters before that logic moves anywhere.
 */
describe('AssignmentSubmissions — which student is selected', () => {
  const twoStudents = [
    { id: 's1', firstName: 'Ada', lastName: 'Lovelace' },
    { id: 's2', firstName: 'Grace', lastName: 'Hopper' },
  ];

  const routesFor = (list: typeof twoStudents) => ({
    '/students': () => ({ ok: true, json: async () => list }),
    'problem-grades/summary': () => ({ ok: true, json: async () => ({}) }),
    '/review-data/': () => ({ ok: true, json: async () => emptyReviewData }),
  });

  afterEach(() => {
    urlQuery.current = 'studentId=s1';
  });

  // The list is sorted by surname, so Hopper precedes Lovelace whatever order the server
  // sent them in. Naming Lovelace proves the URL decides the selection rather than position.
  it('selects the student the URL names, not the first in the list', async () => {
    urlQuery.current = 'studentId=s1';
    vi.stubGlobal('fetch', routeFetch(routesFor(twoStudents)));

    renderWithClient(<AssignmentSubmissions {...baseProps} />);

    const idx = await screen.findByTestId('selected-index');
    await waitFor(() => expect(idx).toHaveTextContent('1'));
  });

  it('falls back to the first student when the URL names someone not on the list', async () => {
    urlQuery.current = 'studentId=nobody';
    vi.stubGlobal('fetch', routeFetch(routesFor(twoStudents)));

    renderWithClient(<AssignmentSubmissions {...baseProps} />);

    const idx = await screen.findByTestId('selected-index');
    await waitFor(() => expect(idx).toHaveTextContent('0'));
  });

  // The case worth having: the selection is stored as an index, but the list can grow under
  // it. Sorting means a reorder from the server changes nothing, so the real hazard is
  // somebody being added ahead of the selected student. It has to follow the student, not
  // the position, or staff quietly end up grading somebody else.
  it('follows the same student when someone is added ahead of them', async () => {
    urlQuery.current = 'studentId=s1';
    const withNewcomer = [...twoStudents, { id: 's3', firstName: 'Zoe', lastName: 'Adams' }];
    let call = 0;
    const fetchMock = routeFetch({
      ...routesFor(twoStudents),
      '/students': () => {
        call += 1;
        return { ok: true, json: async () => (call === 1 ? twoStudents : withNewcomer) };
      },
    });
    vi.stubGlobal('fetch', fetchMock);

    const { client } = renderWithClient(<AssignmentSubmissions {...baseProps} />);
    const idx = await screen.findByTestId('selected-index');
    // Sorted: Hopper, Lovelace. Lovelace (s1) is second.
    await waitFor(() => expect(idx).toHaveTextContent('1'));

    await act(async () => {
      await client.invalidateQueries({ queryKey: ['course', 'c1', 'students', 'all'] });
    });
    await waitFor(() => expect(call).toBe(2));

    // Sorted: Adams, Hopper, Lovelace. Lovelace is now third, and still the one selected.
    await waitFor(() => expect(idx).toHaveTextContent('2'));
  });

  // Everything before a student is selected used to render an empty div, so a course with
  // nobody enrolled looked exactly like a page that had failed to load.
  it('says so when the course has nobody enrolled', async () => {
    vi.stubGlobal(
      'fetch',
      routeFetch({ ...routesFor(twoStudents), '/students': () => ({ ok: true, json: async () => [] }) }),
    );

    renderWithClient(<AssignmentSubmissions {...baseProps} />);

    await waitFor(() => expect(screen.getByText(/Nobody is enrolled/)).toBeInTheDocument());
    expect(screen.queryByTestId('problem-workspace')).not.toBeInTheDocument();
    // Still recognisably the Submissions panel, not a bare message.
    expect(screen.getByRole('heading', { name: /Submissions/ })).toBeInTheDocument();
  });

  it('shows a loading state instead of flashing blank', async () => {
    // A fetch that never settles: the component should be mid-load, not empty.
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));

    renderWithClient(<AssignmentSubmissions {...baseProps} />);

    expect(await screen.findByRole('status')).toHaveTextContent('Loading students');
    expect(screen.queryByText(/Nobody is enrolled/)).not.toBeInTheDocument();
  });

  // A failed load and an empty roster are different problems with different fixes, so they
  // must not read the same.
  it('distinguishes a failed load from an empty roster', async () => {
    vi.stubGlobal(
      'fetch',
      routeFetch({
        ...routesFor(twoStudents),
        '/students': () => ({ ok: false, status: 500, json: async () => ({ error: 'boom' }) }),
      }),
    );

    renderWithClient(<AssignmentSubmissions {...baseProps} />);

    await waitFor(() => expect(screen.getByText(/Could not load the student list/)).toBeInTheDocument());
    expect(screen.queryByText(/Nobody is enrolled/)).not.toBeInTheDocument();
  });
});

/**
 * Grading a group. The whole point is one action instead of the same number typed once per
 * member, so the cases that matter are which endpoint is hit and what happens when members
 * already differ.
 */
describe('AssignmentSubmissions — grading a group', () => {
  const groupReview = {
    ...emptyReviewData,
    isGroupAssignment: true,
    isGroup: true,
    group: { id: 'g1', name: 'Group 3' },
    groupMembers: [{ id: 's2', firstName: 'Grace', lastName: 'Hopper' }],
  };

  const setup = async (groupGradeRoute: () => Record<string, unknown>) => {
    const fetchMock = routeFetch({
      ...baseRoutes(),
      '/review-data/': () => ({ ok: true, json: async () => groupReview }),
      'group-grade': groupGradeRoute as never,
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWithClient(<AssignmentSubmissions {...baseProps} />);
    await screen.findByTestId('problem-workspace');
    // The grade fields are seeded from review data, so typing before it lands is silently
    // undone. The audience only appears once that payload has arrived.
    await waitFor(() => expect(screen.getByTestId('grade-audience')).toHaveTextContent('group'));
    return fetchMock;
  };

  const ok = () => ({
    ok: true,
    status: 200,
    json: async () => ({ grade: 7, applied: 2 }),
    text: async () => JSON.stringify({ grade: 7, applied: 2 }),
  });

  const conflict = () => ({
    ok: false,
    status: 409,
    json: async () => ({
      error: 'Some members already have a different grade',
      conflicts: [{ studentId: 's2', name: 'Grace Hopper', grade: 5 }],
    }),
    text: async () =>
      JSON.stringify({
        error: 'Some members already have a different grade',
        conflicts: [{ studentId: 's2', name: 'Grace Hopper', grade: 5 }],
      }),
  });

  it('sends one write for the group rather than one per member', async () => {
    const fetchMock = await setup(ok);

    fireEvent.change(screen.getByTestId('grade-input'), { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Grade' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/courses/c1/assignments/a1/problems/p1/group-grade/g1',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    // Not the per-student route.
    const perStudent = fetchMock.mock.calls.filter(([u]) => String(u).includes('/grade/s1'));
    expect(perStudent).toHaveLength(0);
  });

  // The server declines rather than overwriting; the grader has to see who and confirm.
  it('asks before overwriting members who already differ', async () => {
    const fetchMock = await setup(conflict);

    fireEvent.change(screen.getByTestId('grade-input'), { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Grade' }));

    expect(await screen.findByText(/Overwrite a grade in Group 3/)).toBeInTheDocument();
    expect(screen.getByText(/Grace Hopper currently has 5/)).toBeInTheDocument();

    // The first attempt must NOT ask to overwrite, or the server would apply it and the
    // dialog would be asking about something already done. The 409 is what makes the
    // confirmation meaningful, so requesting it up front defeats the whole mechanism.
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    const first = calls.find(([u]) => String(u).includes('group-grade'));
    expect(JSON.parse(String(first![1].body))).not.toHaveProperty('overwrite');
  });

  it('retries with overwrite once confirmed', async () => {
    let calls = 0;
    const fetchMock = await setup(() => {
      calls += 1;
      return calls === 1 ? conflict() : ok();
    });

    fireEvent.change(screen.getByTestId('grade-input'), { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Grade' }));
    await screen.findByText(/Overwrite a grade in Group 3/);

    fireEvent.click(screen.getByRole('button', { name: 'Overwrite and apply' }));

    await waitFor(() => expect(calls).toBe(2));
    const sent = fetchMock.mock.calls as unknown as [string, RequestInit][];
    const second = sent.filter(([u]) => String(u).includes('group-grade')).at(-1);
    expect(JSON.parse(String(second![1].body))).toMatchObject({
      grade: 7,
      overwrite: true,
    });
  });

  // Cancelling must leave every grade exactly as it was.
  it('writes nothing when the grader backs out', async () => {
    let calls = 0;
    await setup(() => {
      calls += 1;
      return conflict();
    });

    fireEvent.change(screen.getByTestId('grade-input'), { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Grade' }));
    await screen.findByText(/Overwrite a grade in Group 3/);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() =>
      expect(screen.queryByText(/Overwrite a grade in Group 3/)).not.toBeInTheDocument(),
    );
    expect(calls).toBe(1);
  });

  it('uses the per-student route on an individual assignment', async () => {
    const fetchMock = routeFetch({
      ...baseRoutes(),
      '/problems/p1/grade/s1': () => ({
        ok: true,
        json: async () => ({ ok: true }),
        text: async () => JSON.stringify({ ok: true }),
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWithClient(<AssignmentSubmissions {...baseProps} />);
    await screen.findByTestId('problem-workspace');
    // No audience on an individual assignment, and it doubles as the "review data has
    // seeded" signal: typing before that lands is silently undone.
    await waitFor(() => expect(screen.getByTestId('grade-audience')).toHaveTextContent('none'));

    fireEvent.change(screen.getByTestId('grade-input'), { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Grade' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/courses/c1/assignments/a1/problems/p1/grade/s1',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    // Assert the value too: the route alone passes even when the grade was cleared.
    const call = (fetchMock.mock.calls as unknown as [string, RequestInit][]).find(
      ([u, init]) => String(u).includes('/grade/s1') && init?.method === 'POST',
    );
    expect(JSON.parse(String(call![1].body))).toMatchObject({ grade: 7 });
  });
});
