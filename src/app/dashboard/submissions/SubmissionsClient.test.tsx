/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SubmissionsClient from './SubmissionsClient';

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

// Props are surfaced as attributes so a test can assert the viewer was opened, and on
// which file, without pulling in cytoscape.
vi.mock('@/components/JffViewerDialog', () => ({
  default: ({ open, src, title }: { open: boolean; src?: string; title?: string }) => (
    <div data-testid="jff-viewer" data-open={String(open)} data-src={src} data-title={title} />
  ),
}));

vi.mock('@/components/dialogs/FeedbackDialog', () => ({
  FeedbackDialog: () => <div data-testid="feedback-dialog" />,
}));

// Endpoint payloads. Only courses and the submissions page are fetched on load now: the
// assignment and problem lists stay unfetched until the admin narrows to a course.
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
    type: 'FA',
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
    // Both ride along on the row now, rather than being looked up in the picker lists.
    dueDate: '2026-02-01T00:00:00.000Z',
    problemType: 'FA',
    submittedAt: '2026-01-15T00:00:00.000Z',
    status: 'COMPLETED',
    autograderEnabled: true,
    isGroupAssignment: false,
    grade: 8,
    correct: true,
    maxPoints: 10,
    problemTitle: 'Problem One',
    fileName: 'sub-1.jff',
    originalFileName: 'sub-1.jff',
    feedback: 'Nice work',
  },
];

const jsonResponse = (data: unknown) => ({ ok: true, json: async () => data });

type FetchMock = ReturnType<typeof vi.fn>;

/** The paginated envelope the route returns. */
const page = (rows: unknown[]) => ({ rows, total: rows.length });

// Route each request by URL (and method) to the matching payload.
const installFetchRouter = (
  submissions: unknown[] = SUBMISSIONS,
  onSubmissionsCall?: (init?: RequestInit) => void,
) => {
  const fetchMock = global.fetch as FetchMock;
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === '/api/me/courses') return jsonResponse(COURSES);
    if (url === '/api/courses/course-1/assignments') return jsonResponse(ASSIGNMENTS);
    if (url === '/api/assignments/assign-1/problems') return jsonResponse(PROBLEMS);
    if (url === '/api/admin/submissions' && init?.method === 'POST') {
      onSubmissionsCall?.(init);
      return jsonResponse(page(submissions));
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

/** The body of the most recent submissions POST. */
const lastQuery = (fetchMock: FetchMock) => {
  const calls = submissionsPostCalls(fetchMock);
  return JSON.parse(String((calls[calls.length - 1][1] as RequestInit).body));
};

describe('SubmissionsClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
    // SubmissionsClient.tsx does not import React, and the test transform uses
    // the classic JSX runtime, so its compiled `React.createElement` calls
    // resolve `React` from the global scope. Provide it without touching the
    // component. (This test file itself uses the same classic transform.)
    vi.stubGlobal('React', React);
  });

  it('asks for the first page with an empty scope, without fanning out over courses', async () => {
    const fetchMock = installFetchRouter();

    renderWithClient(<SubmissionsClient />);

    await waitFor(() => expect(screen.getByText('ada@example.com')).toBeInTheDocument());

    // Exactly one submissions request, and the scope lists are empty: "everything" is said
    // by sending nothing, not by enumerating every id in the installation.
    expect(submissionsPostCalls(fetchMock)).toHaveLength(1);
    expect(lastQuery(fetchMock)).toMatchObject({
      courseIds: [],
      assignmentIds: [],
      problemIds: [],
      page: 1,
      pageSize: 10,
      sortBy: 'submittedAt',
      sortDir: 'desc',
    });

    // The per-course and per-assignment lists are what used to make this page issue
    // hundreds of requests before it could render. Nothing is selected, so neither is
    // fetched at all.
    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(urls).not.toContain('/api/courses/course-1/assignments');
    expect(urls).not.toContain('/api/assignments/assign-1/problems');
  });

  it('sends the whole request as JSON', async () => {
    let capturedInit: RequestInit | undefined;
    installFetchRouter(SUBMISSIONS, (init) => {
      capturedInit = init;
    });

    renderWithClient(<SubmissionsClient />);
    await waitFor(() => expect(screen.getByText('ada@example.com')).toBeInTheDocument());

    expect(capturedInit?.method).toBe('POST');
    expect(capturedInit?.headers).toMatchObject({ 'Content-Type': 'application/json' });
  });

  it('reports the server total rather than the number of rows on screen', async () => {
    const fetchMock = global.fetch as FetchMock;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/me/courses') return jsonResponse(COURSES);
      if (url === '/api/admin/submissions' && init?.method === 'POST') {
        // One row on this page, 42 matching overall.
        return jsonResponse({ rows: SUBMISSIONS, total: 42 });
      }
      throw new Error(`Unexpected fetch: ${String(url)}`);
    });

    renderWithClient(<SubmissionsClient />);
    await waitFor(() => expect(screen.getByText('ada@example.com')).toBeInTheDocument());

    // 42 rows at 10 per page is 5 pages, and the footer counts the whole result set rather
    // than the single row the browser is holding. (The text appears twice: once visibly and
    // once in the table's live region.)
    expect(screen.getAllByText(/Page 1 of 5/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/of 42 records/).length).toBeGreaterThan(0);
  });

  it('keeps the current page on screen while the next one loads', async () => {
    // keepPreviousData is only worth having if the table is not told it is loading on
    // every page change. Driving `loading` from isFetching instead of isLoading would
    // replace the rows with the loading placeholder each time.
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchMock = global.fetch as FetchMock;
    let call = 0;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/me/courses') return jsonResponse(COURSES);
      if (url === '/api/admin/submissions' && init?.method === 'POST') {
        call += 1;
        if (call > 1) await gate; // hold the second page in flight
        return jsonResponse({ rows: SUBMISSIONS, total: 42 });
      }
      throw new Error(`Unexpected fetch: ${String(url)}`);
    });

    renderWithClient(<SubmissionsClient />);
    await waitFor(() => expect(screen.getByText('ada@example.com')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /next page/i }));

    // Still showing the previous page's rows, not the loading placeholder.
    await waitFor(() => expect(submissionsPostCalls(fetchMock).length).toBe(2));
    expect(screen.getByText('ada@example.com')).toBeInTheDocument();
    expect(screen.queryByText('Loading submissions, please wait...')).toBeNull();

    release?.();
  });

  it('asks the server for the next page instead of slicing the rows it holds', async () => {
    const fetchMock = global.fetch as FetchMock;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/me/courses') return jsonResponse(COURSES);
      if (url === '/api/admin/submissions' && init?.method === 'POST') {
        return jsonResponse({ rows: SUBMISSIONS, total: 42 });
      }
      throw new Error(`Unexpected fetch: ${String(url)}`);
    });

    renderWithClient(<SubmissionsClient />);
    await waitFor(() => expect(screen.getByText('ada@example.com')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /next page/i }));

    await waitFor(() => expect(lastQuery(fetchMock).page).toBe(2));
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
        return jsonResponse(page(SUBMISSIONS));
      }
      throw new Error(`Unexpected fetch: ${String(url)}`);
    });

    renderWithClient(<SubmissionsClient />);

    // While the POST is pending, the table shows the loading placeholder.
    await waitFor(() => {
      expect(submissionsPostCalls(fetchMock).length).toBeGreaterThanOrEqual(1);
    });
    expect(screen.getByText('Loading submissions, please wait...')).toBeInTheDocument();

    // Releasing the POST lets the row render.
    releaseSubmissions?.();
    await waitFor(() => {
      expect(screen.getByText('ada@example.com')).toBeInTheDocument();
    });
  });

  it('opens with nothing filtered, so every submission is on screen', async () => {
    installFetchRouter();
    renderWithClient(<SubmissionsClient />);

    // The fixture row is graded, and it shows: the queue no longer opens narrowed to
    // outstanding work, so what is on screen is everything the pickers allow through.
    await waitFor(() => expect(screen.getByText('ada@example.com')).toBeInTheDocument());
    const pending = await screen.findByRole('checkbox', { name: /^Pending/ });
    expect(pending).toHaveAttribute('data-state', 'unchecked');
  });

  it('keeps Status and Submission as one filter under two headings', async () => {
    installFetchRouter();
    renderWithClient(<SubmissionsClient />);
    await waitFor(() => expect(screen.getByText('ada@example.com')).toBeInTheDocument());

    // Two headings, so "where has it got to" and "how did it turn out" read as separate
    // questions, but ticking one from each still widens rather than returning nothing.
    for (const name of ['Pending', 'Processing', 'Failed', 'Correct', 'Incorrect', 'On time', 'Late']) {
      expect(screen.getByRole('checkbox', { name: new RegExp(`^${name}`) })).toBeInTheDocument();
    }
  });

  it('offers the row actions in an actions menu, including a link into submission review', async () => {
    installFetchRouter();
    renderWithClient(<SubmissionsClient />);
    await waitFor(() => expect(screen.getByText('ada@example.com')).toBeInTheDocument());

    // One Manage control per row, named after the student so screen reader users can
    // tell two rows apart.
    expect(
      screen.getByRole('button', { name: 'Actions for the submission by Lovelace, Ada' }),
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

  it('shows the grading result as a badge in its own Status column', async () => {
    installFetchRouter();
    renderWithClient(<SubmissionsClient />);
    await waitFor(() => expect(screen.getByText('ada@example.com')).toBeInTheDocument());

    // Scoped to the grid, because the same words label the checkboxes in the Filters
    // popover. The fixture row is graded correct and on time.
    const table = screen.getByRole('table');
    expect(within(table).getByText('Correct').closest('[data-slot="badge"]')).not.toBeNull();
    expect(within(table).getByText('On time').closest('[data-slot="badge"]')).not.toBeNull();

    // Status has a column of its own and sorts server-side. aria-sort is only set on a
    // sortable header, so its presence is the assertion.
    expect(within(table).getByRole('columnheader', { name: 'Status' })).toHaveAttribute(
      'aria-sort',
      'none',
    );
    // Timing does not: it compares submittedAt against the assignment's due date rather
    // than reading a column, so the server cannot order the whole queue by it and a
    // client sort would silently reorder only the page on screen.
    expect(within(table).getByRole('columnheader', { name: 'Timing' })).not.toHaveAttribute(
      'aria-sort',
    );
  });

  it('sorts through the server and returns to the first page', async () => {
    const fetchMock = installFetchRouter();
    renderWithClient(<SubmissionsClient />);
    await waitFor(() => expect(screen.getByText('ada@example.com')).toBeInTheDocument());

    // Scoped to the grid: "Student" also names an option in the search-scope picker.
    const table = screen.getByRole('table');
    fireEvent.click(within(table).getByRole('button', { name: /^Student/ }));

    await waitFor(() => {
      expect(lastQuery(fetchMock)).toMatchObject({ sortBy: 'student', page: 1 });
    });
  });

  it('leaves the derived grade columns unsortable', async () => {
    installFetchRouter();
    renderWithClient(<SubmissionsClient />);
    await waitFor(() => expect(screen.getByText('ada@example.com')).toBeInTheDocument());

    // Grade is derived from `correct` and the problem's points, so there is no column to
    // order the whole result set by.
    const table = screen.getByRole('table');
    expect(within(table).getByRole('columnheader', { name: 'Grade' })).not.toHaveAttribute(
      'aria-sort',
    );
  });

  it('lists the submitted file, opening the viewer from its name and downloading from the icon', async () => {
    installFetchRouter();
    renderWithClient(<SubmissionsClient />);
    await waitFor(() => expect(screen.getByText('ada@example.com')).toBeInTheDocument());

    const table = screen.getByRole('table');
    const download = within(table).getByRole('link', { name: 'Download sub-1.jff' });
    // The download link asks to be audited as a download; the viewer below deliberately
    // does not, so opening a solution is not recorded as taking a copy of it.
    expect(download).toHaveAttribute('href', '/api/files/submissions/sub-1.jff?download=1');
    expect(download).toHaveAttribute('download', 'sub-1.jff');

    // The viewer picks itself by problem type, which is only known once a row is chosen,
    // so nothing is mounted until the name is clicked.
    expect(screen.queryByTestId('jff-viewer')).toBeNull();
    fireEvent.click(within(table).getByRole('button', { name: 'sub-1.jff' }));
    await waitFor(() => {
      const viewer = screen.getByTestId('jff-viewer');
      expect(viewer).toHaveAttribute('data-open', 'true');
      expect(viewer).toHaveAttribute('data-src', '/api/files/submissions/sub-1.jff');
    });
  });

  it('grades each row on its own result rather than the student recorded grade', async () => {
    // The fixture is a correct attempt on a 10 point problem whose recorded grade is 8,
    // so the two numbers cannot be confused for one another.
    installFetchRouter();
    renderWithClient(<SubmissionsClient />);
    await waitFor(() => expect(screen.getByText('ada@example.com')).toBeInTheDocument());

    const table = screen.getByRole('table');
    expect(within(table).getByText('10 / 10')).toBeInTheDocument();
    // Recorded grade is a column of its own and starts hidden, so the standing 8 is not
    // repeated down every attempt.
    expect(within(table).queryByText('8 / 10')).toBeNull();
    expect(
      within(table).queryByRole('columnheader', { name: 'Recorded grade' }),
    ).not.toBeInTheDocument();
  });

  it('scores an incorrect attempt zero and leaves an ungraded one blank', async () => {
    installFetchRouter([
      { ...SUBMISSIONS[0], id: 'sub-2', correct: false },
      {
        ...SUBMISSIONS[0],
        id: 'sub-3',
        studentEmail: 'grace@example.com',
        studentFirstName: 'Grace',
        studentLastName: 'Hopper',
        status: 'pending',
        correct: null,
      },
    ]);
    renderWithClient(<SubmissionsClient />);
    await waitFor(() => expect(screen.getByText('ada@example.com')).toBeInTheDocument());

    const table = screen.getByRole('table');
    expect(within(table).getByText('0 / 10')).toBeInTheDocument();
    // Nothing has been evaluated for the pending row, so it shows a dash instead of a
    // zero that would read as a failed attempt.
    expect(within(table).queryByText('10 / 10')).toBeNull();
    expect(within(table).getAllByText('-').length).toBeGreaterThanOrEqual(1);
  });

  it('ticking a Status value asks the server for it and returns to the first page', async () => {
    const fetchMock = global.fetch as FetchMock;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/me/courses') return jsonResponse(COURSES);
      if (url === '/api/admin/submissions' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body));
        // The one fixture row is correct, so the server returns nothing for Incorrect.
        return jsonResponse(body.status.includes('incorrect') ? page([]) : page(SUBMISSIONS));
      }
      throw new Error(`Unexpected fetch: ${String(url)}`);
    });

    renderWithClient(<SubmissionsClient />);
    await waitFor(() => expect(screen.getByText('ada@example.com')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('checkbox', { name: /^Incorrect/ }));

    await waitFor(() => {
      expect(lastQuery(fetchMock)).toMatchObject({ status: ['incorrect'], page: 1 });
    });
    await waitFor(() => {
      expect(screen.queryByText('ada@example.com')).toBeNull();
      // DataTable's own empty state takes over, and says the filters are the reason
      // rather than leaving the table silently blank.
      expect(screen.getByText('No submissions match your filters')).toBeInTheDocument();
    });
  });

  it('sends the timing filter as its own dimension, so it ANDs with Status', async () => {
    const fetchMock = installFetchRouter();
    renderWithClient(<SubmissionsClient />);
    await waitFor(() => expect(screen.getByText('ada@example.com')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('checkbox', { name: /^Late/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /^Failed/ }));

    await waitFor(() => {
      expect(lastQuery(fetchMock)).toMatchObject({ timing: ['late'], status: ['failed'] });
    });
  });
});

describe('SubmissionsClient — beyond the autograder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
    vi.stubGlobal('React', React);
  });

  // The page lists everything handed in, so a hand-graded problem appears with no queue
  // state. Showing it as "Incorrect" or "Pending" would be inventing one.
  it('reports a hand-graded problem as manually graded', async () => {
    installFetchRouter([{ ...SUBMISSIONS[0]!, autograderEnabled: false }]);

    renderWithClient(<SubmissionsClient />);

    expect(await screen.findByText('Not autograded')).toBeInTheDocument();
    // Scoped to the table: "Correct" is also a choice in the Filters menu, so an unscoped
    // query would pass whatever the row said.
    expect(within(screen.getByRole('table')).queryByText('Correct')).not.toBeInTheDocument();
  });

  it('says whether the work was handed in as a group', async () => {
    installFetchRouter([{ ...SUBMISSIONS[0]!, isGroupAssignment: true }]);

    renderWithClient(<SubmissionsClient />);

    expect(await screen.findByText('Group')).toBeInTheDocument();
  });

  it('says individual otherwise', async () => {
    installFetchRouter();

    renderWithClient(<SubmissionsClient />);

    expect(await screen.findByText('Individual')).toBeInTheDocument();
  });
});
