/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AutograderQueueClient from './AutograderQueueClient';

// Fresh QueryClient per test (retry off, no lingering cache) so the submissions
// query starts clean each time.
const renderWithClient = (ui: React.ReactElement) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
};

vi.mock('@/lib/toast', () => import('@/test/mocks/toast').then((m) => m.toastModuleMock));

// The table's Filters control is a Radix popover, which needs pointer capture jsdom does
// not implement. Render its content inline so the status checkboxes are queryable.
vi.mock('@/components/ui/popover', () => {
  const Pass = ({ children }: { children: React.ReactNode }) => <>{children}</>;
  return {
    Popover: Pass,
    PopoverTrigger: Pass,
    PopoverContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    PopoverAnchor: Pass,
  };
});

// The manage menu is a Radix dropdown, which drives itself with pointer capture and
// portals that jsdom does not implement. Render its content inline so the items are
// queryable; the trigger is a plain button either way.
vi.mock('@/components/ui/dropdown-menu', () => {
  const Pass = ({ children }: { children: React.ReactNode }) => <>{children}</>;
  const Item = ({
    children,
    onClick,
    disabled,
    asChild,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    asChild?: boolean;
  }) =>
    // asChild means the caller supplied its own element (a Link here); render it as is
    // so the anchor and its href survive.
    asChild ? (
      <>{children}</>
    ) : (
      <button type="button" onClick={onClick} disabled={disabled}>
        {children}
      </button>
    );
  return {
    DropdownMenu: Pass,
    DropdownMenuPortal: Pass,
    DropdownMenuTrigger: Pass,
    DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    DropdownMenuGroup: Pass,
    DropdownMenuLabel: Pass,
    DropdownMenuItem: Item,
    DropdownMenuCheckboxItem: Item,
    DropdownMenuRadioGroup: Pass,
    DropdownMenuRadioItem: Item,
    DropdownMenuSeparator: () => null,
    DropdownMenuShortcut: Pass,
    DropdownMenuSub: Pass,
    DropdownMenuSubTrigger: Pass,
    DropdownMenuSubContent: Pass,
  };
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => ({ get: () => null, toString: () => '' }),
}));

vi.mock('@/hooks/use-empty-string-symbol', () => ({
  useEmptyStringSymbol: () => 'ε',
}));

// Replace the multi-select dropdowns with a trivial stub so their internal
// Radix machinery does not interfere with the selection chain under test. The
// component drives its own selection via effects, so the stub needs no behavior.
vi.mock('@/components/ui/SearchableMultiSelect', () => ({
  SearchableMultiSelect: ({ label }: { label?: string }) => (
    <div data-testid={`multiselect-${label ?? 'unlabeled'}`} />
  ),
}));

vi.mock('@/components/JffViewerDialog', () => ({
  default: () => <div data-testid="jff-viewer" />,
}));

vi.mock('@/components/dialogs/FeedbackDialog', () => ({
  FeedbackDialog: () => <div data-testid="feedback-dialog" />,
}));

// Endpoint payloads for the selection chain.
const COURSES = [{ id: 'course-1', name: 'Automata Theory', code: 'CS500' }];

const ASSIGNMENTS = [
  {
    id: 'assign-1',
    title: 'Assignment One',
    dueDate: '2026-02-01T00:00:00.000Z',
    problems: [{ problemId: 'prob-1', maxPoints: 10 }],
  },
];

const PROBLEMS = [
  {
    id: 'prob-1',
    title: 'Problem One',
    description: null,
    type: 'DFA',
    maxPoints: 10,
    maxStates: null,
    isDeterministic: true,
    solved: false,
    grade: null,
  },
];

const SUBMISSIONS = [
  {
    id: 'sub-1',
    studentId: 'student-1',
    courseId: 'course-1',
    assignmentId: 'assign-1',
    problemId: 'prob-1',
    studentFirstName: 'Ada',
    studentLastName: 'Lovelace',
    studentEmail: 'ada@example.com',
    courseName: 'Automata Theory',
    assignmentTitle: 'Assignment One',
    submittedAt: '2026-01-15T00:00:00.000Z',
    status: 'graded',
    grade: 8,
    correct: true,
    maxPoints: 10,
    problemTitle: 'Problem One',
    avatar: null,
    fileName: 'sub-1.jff',
    originalFileName: 'sub-1.jff',
    feedback: 'Nice work',
  },
];

const jsonResponse = (data: unknown) => ({ ok: true, json: async () => data });

type FetchMock = ReturnType<typeof vi.fn>;

// Route each request by URL (and method) to the matching payload. This lets the
// component's fetch-courses -> fetch-assignments -> fetch-problems -> POST
// submissions cascade run to completion without guessing which call is next.
const installFetchRouter = (
  submissions: unknown = SUBMISSIONS,
  onSubmissionsCall?: (init?: RequestInit) => void,
) => {
  const fetchMock = global.fetch as FetchMock;
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === '/api/me/courses') return jsonResponse(COURSES);
    if (url === '/api/courses/course-1/assignments') return jsonResponse(ASSIGNMENTS);
    if (url === '/api/assignments/assign-1/problems') return jsonResponse(PROBLEMS);
    if (url === '/api/admin/submissions' && init?.method === 'POST') {
      onSubmissionsCall?.(init);
      return jsonResponse(submissions);
    }
    throw new Error(`Unexpected fetch: ${String(url)}`);
  });
  return fetchMock;
};

const submissionsPostCalls = (fetchMock: FetchMock) =>
  fetchMock.mock.calls.filter(
    ([url, init]) =>
      url === '/api/admin/submissions' && (init as RequestInit | undefined)?.method === 'POST',
  );

/**
 * Clear the Status filter so every row shows.
 *
 * The page opens filtered to Pending and Processing, because that is the outstanding work
 * an admin comes to the queue for. The fixture row is graded, so a test that wants to see
 * it unticks both first, exactly as a user would through the Filters button.
 */
const showAllStatuses = async () => {
  fireEvent.click(await screen.findByRole('checkbox', { name: /^Pending/ }));
  fireEvent.click(await screen.findByRole('checkbox', { name: /^Processing/ }));
};

describe('AutograderQueueClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
    // AutograderQueueClient.tsx does not import React, and the test transform uses
    // the classic JSX runtime, so its compiled `React.createElement` calls
    // resolve `React` from the global scope. Provide it without touching the
    // component. (This test file itself uses the same classic transform.)
    vi.stubGlobal('React', React);
  });

  it('renders the idle empty state without POSTing submissions before anything is selected', async () => {
    // Courses endpoint never resolves, so no course is selected and the chain
    // never reaches the submissions POST.
    const fetchMock = global.fetch as FetchMock;
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/me/courses') return new Promise(() => {}); // pending forever
      throw new Error(`Unexpected fetch: ${String(url)}`);
    });

    renderWithClient(<AutograderQueueClient />);

    // Nothing selected -> fetchSubmissions short-circuits to [] with no network call.
    await waitFor(() => {
      expect(screen.getByText('Loading submissions, please wait...')).toBeInTheDocument();
    });
    expect(submissionsPostCalls(fetchMock)).toHaveLength(0);
  });

  it('drives the selection chain and POSTs the selected problemIds, rendering the returned rows', async () => {
    let capturedInit: RequestInit | undefined;
    const fetchMock = installFetchRouter(SUBMISSIONS, (init) => {
      capturedInit = init;
    });

    renderWithClient(<AutograderQueueClient />);
    await showAllStatuses();

    // The submitted student row renders once the cascade completes.
    await waitFor(() => {
      expect(screen.getByText('ada@example.com')).toBeInTheDocument();
    });

    const posts = submissionsPostCalls(fetchMock);
    expect(posts.length).toBeGreaterThanOrEqual(1);

    // The final POST carries the auto-selected problem ids as JSON.
    expect(capturedInit?.method).toBe('POST');
    expect(capturedInit?.headers).toMatchObject({ 'Content-Type': 'application/json' });
    const body = JSON.parse(String(capturedInit?.body));
    expect(body).toEqual({ problemIds: ['prob-1'] });
  });

  it('seeds selectedProblems only from the loaded problem list (single POST on load)', async () => {
    // The assignment lists its problems in one order; the problems endpoint returns
    // them in another. Previously the assignments effect ALSO seeded selectedProblems
    // (from the assignment's problem ids), so on load the query key was written twice
    // with different orders and the submissions POST fired twice. Now only the problems
    // effect seeds it, so exactly one POST goes out and its ids follow the problem list.
    const problem = (id: string, title: string) => ({
      id,
      title,
      description: null,
      type: 'DFA',
      maxPoints: 10,
      maxStates: null,
      isDeterministic: true,
      solved: false,
      grade: null,
    });
    const capturedBodies: string[] = [];
    const fetchMock = global.fetch as FetchMock;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/me/courses') return jsonResponse(COURSES);
      if (url === '/api/courses/course-1/assignments')
        return jsonResponse([
          {
            id: 'assign-1',
            title: 'Assignment One',
            dueDate: '2026-02-01T00:00:00.000Z',
            problems: [
              { problemId: 'prob-1', maxPoints: 10 },
              { problemId: 'prob-2', maxPoints: 10 },
            ],
          },
        ]);
      if (url === '/api/assignments/assign-1/problems')
        // Reverse order relative to the assignment's problem list.
        return jsonResponse([problem('prob-2', 'Problem Two'), problem('prob-1', 'Problem One')]);
      if (url === '/api/admin/submissions' && init?.method === 'POST') {
        capturedBodies.push(String(init?.body));
        return jsonResponse(SUBMISSIONS);
      }
      throw new Error(`Unexpected fetch: ${String(url)}`);
    });

    renderWithClient(<AutograderQueueClient />);
    await showAllStatuses();

    // Wait until the row renders (the submissions POST resolved).
    await waitFor(() => expect(screen.getByText('ada@example.com')).toBeInTheDocument());

    const posts = submissionsPostCalls(fetchMock);
    expect(posts).toHaveLength(1);
    // The one POST follows the problem list's order, not the assignment's — proof it
    // was seeded by the problems effect alone.
    expect(JSON.parse(capturedBodies[0])).toEqual({ problemIds: ['prob-2', 'prob-1'] });
  });

  it('shows the loading text while the submissions query is in flight', async () => {
    let releaseSubmissions: (() => void) | undefined;
    const submissionsGate = new Promise<void>((resolve) => {
      releaseSubmissions = resolve;
    });

    const fetchMock = global.fetch as FetchMock;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/me/courses') return jsonResponse(COURSES);
      if (url === '/api/courses/course-1/assignments') return jsonResponse(ASSIGNMENTS);
      if (url === '/api/assignments/assign-1/problems') return jsonResponse(PROBLEMS);
      if (url === '/api/admin/submissions' && init?.method === 'POST') {
        await submissionsGate; // hold the query in flight
        return jsonResponse(SUBMISSIONS);
      }
      throw new Error(`Unexpected fetch: ${String(url)}`);
    });

    renderWithClient(<AutograderQueueClient />);

    // While the POST is pending, the table shows the loading placeholder.
    await waitFor(() => {
      expect(submissionsPostCalls(fetchMock).length).toBeGreaterThanOrEqual(1);
    });
    expect(screen.getByText('Loading submissions, please wait...')).toBeInTheDocument();

    // Releasing the POST lets the row render.
    releaseSubmissions?.();
    await showAllStatuses();
    await waitFor(() => {
      expect(screen.getByText('ada@example.com')).toBeInTheDocument();
    });
  });

  it('opens with the Result filter set to Pending, hiding a graded submission', async () => {
    installFetchRouter();
    renderWithClient(<AutograderQueueClient />);

    // Pending starts ticked in the table's own Filters popover.
    const pending = await screen.findByRole('checkbox', { name: /^Pending/ });
    await waitFor(() => expect(pending).toHaveAttribute('data-state', 'checked'));
    // The fixture row is graded, so the default view excludes it.
    expect(screen.queryByText('ada@example.com')).toBeNull();

    await showAllStatuses();
    await waitFor(() => expect(screen.getByText('ada@example.com')).toBeInTheDocument());
  });

  it('offers the row actions in a manage menu, including a link into submission review', async () => {
    installFetchRouter();
    renderWithClient(<AutograderQueueClient />);
    await showAllStatuses();
    await waitFor(() => expect(screen.getByText('ada@example.com')).toBeInTheDocument());

    // One Manage control per row, named after the student so screen reader users can
    // tell two rows apart.
    expect(
      screen.getByRole('button', { name: 'Manage submission by Lovelace, Ada' }),
    ).toBeInTheDocument();

    // Every action the old icon row offered still exists, plus the review link.
    expect(screen.getByText('View submission')).toBeInTheDocument();
    expect(screen.getByText('View feedback')).toBeInTheDocument();
    expect(screen.getByText('Download')).toBeInTheDocument();
    // The only Rerun on the page: rerunning is per submission now, from this menu, since
    // the header's bulk rerun could no longer describe which rows it would act on.
    expect(screen.getAllByText('Rerun')).toHaveLength(1);

    const review = screen.getByRole('link', { name: /open in submission review/i });
    expect(review).toHaveAttribute(
      'href',
      '/dashboard/courses/course-1/assign-1?tab=submissions&studentId=student-1&problemId=prob-1',
    );
  });

  it('ticking a Status value in the table filter narrows the rows', async () => {
    installFetchRouter();
    renderWithClient(<AutograderQueueClient />);
    await showAllStatuses();
    await waitFor(() => expect(screen.getByText('ada@example.com')).toBeInTheDocument());

    // The single row is correct, so filtering to Incorrect hides it.
    fireEvent.click(screen.getByRole('checkbox', { name: /^Incorrect/ }));

    await waitFor(() => {
      expect(screen.queryByText('ada@example.com')).toBeNull();
      // DataTable's own empty state takes over, and says the filters are the reason
      // rather than leaving the table silently blank.
      expect(screen.getByText('No submissions match your filters')).toBeInTheDocument();
    });
  });
});
