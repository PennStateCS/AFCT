/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import PrivilegeAssignmentView from './PrivilegeAssignmentView';

/* ─────────────────────────────── hoisted spies ──────────────────────────── */

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
const nav = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
// The search params the component reads on mount (drives the initial tab).
const searchState = vi.hoisted(() => ({ value: '' }));
// Captures the callbacks PrivilegeAssignmentView hands to buildProblemColumns, so
// the DataTable stub can invoke the real component handlers (openRenderViewer, …).
const colParams = vi.hoisted(
  () => ({ current: null }) as { current: Record<string, (arg: unknown) => void> | null },
);

/* ──────────────────────────────────  mocks  ─────────────────────────────── */

vi.mock('@/lib/toast', () => ({ showToast: toast }));

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'c1', aid: 'a1' }),
  useSearchParams: () => new URLSearchParams(searchState.value),
  useRouter: () => nav,
}));

vi.mock('@/lib/useEmptyStringSymbol', () => ({ useEmptyStringSymbol: () => 'ε' }));
vi.mock('@/hooks/use-effective-timezone', () => ({
  useEffectiveTimezone: () => ({ timezone: 'UTC' }),
}));

// Capture the params (real handlers) and return a trivial column set; the cell
// rendering itself is covered by problem-columns.test.tsx.
vi.mock('./problem-columns', () => ({
  buildProblemColumns: (params: Record<string, (arg: unknown) => void>) => {
    colParams.current = params;
    return [];
  },
}));

// Lightweight DataTable: shows the loading flag and, per row, buttons wired to the
// captured column callbacks so the view's own handlers run under real React state.
vi.mock('@/components/ui/data-table', () => ({
  DataTable: ({ data, loading }: { data: Array<Record<string, unknown>>; loading?: boolean }) => (
    <div data-testid="data-table">
      {loading ? <span>table-loading</span> : null}
      {data.map((row) => {
        const p = colParams.current;
        const id = String(row.id);
        return (
          <div key={id} data-testid={`row-${id}`}>
            <span>{String(row.title)}</span>
            <button type="button" onClick={() => p?.openDescription(row.description)}>
              desc-{id}
            </button>
            <button type="button" onClick={() => p?.openRenderViewer(row)}>
              render-{id}
            </button>
            <button type="button" onClick={() => p?.handleEditProblem(row)}>
              edit-{id}
            </button>
            <button type="button" onClick={() => p?.onRemoveProblem(row)}>
              remove-{id}
            </button>
          </div>
        );
      })}
    </div>
  ),
}));

vi.mock('@/components/ui/SelectField', () => ({
  __esModule: true,
  default: ({
    label,
    value,
    onValueChange,
    options,
    disabled,
  }: {
    label: string;
    value?: string;
    onValueChange?: (v: string) => void;
    options: Array<{ value: string; label: string }>;
    disabled?: boolean;
  }) => (
    <select
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(e) => onValueChange?.(e.target.value)}
    >
      <option value="">choose</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
}));

// Child dialogs: prop-capturing stubs that surface open state and expose their
// callbacks as buttons so the parent's handlers can be exercised.
vi.mock('@/components/dialogs/AssociateProblemsDialog', () => ({
  AssociateProblemsDialog: ({
    open,
    allProblems,
    onAddProblems,
  }: {
    open: boolean;
    allProblems: Array<{ id: string }>;
    onAddProblems: (ids: string[], groupId?: string, settings?: unknown) => void;
  }) =>
    open ? (
      <div data-testid="associate-dialog">
        <span>{`picker-count:${allProblems.length}`}</span>
        <button type="button" onClick={() => onAddProblems(['p9'])}>
          assoc-add
        </button>
      </div>
    ) : null,
}));

vi.mock('@/components/dialogs/ConfirmDialog', () => ({
  ConfirmDialog: ({
    open,
    description,
    onConfirm,
    onCancel,
  }: {
    open: boolean;
    description?: string;
    onConfirm: () => void;
    onCancel: () => void;
  }) =>
    open ? (
      <div data-testid="confirm-dialog">
        <p>{description}</p>
        <button type="button" onClick={onConfirm}>
          confirm-remove
        </button>
        <button type="button" onClick={onCancel}>
          cancel-remove
        </button>
      </div>
    ) : null,
}));

vi.mock('@/components/dialogs/SubmissionViewerDialog', () => ({
  SubmissionViewerDialog: ({
    open,
    src,
    title,
    problemType,
  }: {
    open: boolean;
    src: string;
    title?: string;
    problemType?: string | null;
  }) =>
    open ? (
      <div data-testid="viewer-dialog" data-src={src} data-type={problemType ?? ''}>
        {title}
      </div>
    ) : null,
}));

vi.mock('@/components/dialogs/CreateProblemDialog', () => ({
  CreateProblemDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="create-dialog" /> : null,
}));

vi.mock('@/components/assignments/AssignmentSettingsCard', () => ({
  AssignmentSettingsCard: () => <div data-testid="assignment-settings" />,
}));

vi.mock('@/components/dialogs/EditProblemDialog', () => ({
  EditProblemDialog: ({
    open,
    problem,
  }: {
    open: boolean;
    problem: { id: string; courseId?: string };
  }) =>
    open ? (
      <div
        data-testid="edit-problem-dialog"
        data-problem-id={problem.id}
        data-course-id={problem.courseId}
      />
    ) : null,
}));

vi.mock('@/components/AssignmentSubmissions', () => ({
  __esModule: true,
  default: ({ courseId, assignmentId }: { courseId: string; assignmentId: string }) => (
    <div
      data-testid="assignment-submissions"
      data-course={courseId}
      data-assignment={assignmentId}
    />
  ),
}));

/* ──────────────────────────────── fixtures ──────────────────────────────── */

type Problem = {
  id: string;
  title: string;
  type: string;
  description: string | null;
  fileName: string | null;
  originalFileName: string | null;
  maxStates: number;
  isDeterministic: boolean;
};

const problem = (over: Partial<Problem> = {}): Problem => ({
  id: 'p1',
  title: 'Problem One',
  type: 'FA',
  description: 'Desc one',
  fileName: 'sol1.jff',
  originalFileName: 'orig1.jff',
  maxStates: 5,
  isDeterministic: true,
  ...over,
});

const p1 = problem();
const p2 = problem({
  id: 'p2',
  title: 'Problem Two',
  type: 'RE',
  description: null,
  fileName: null,
  originalFileName: null,
});

const makeAssignment = (over: Record<string, unknown> = {}) => ({
  id: 'a1',
  title: 'Regular Languages',
  description: 'Do the thing.',
  isPublished: true,
  isGroup: false,
  dueDate: '2999-01-01T00:00:00Z', // far future → not past due
  maxPoints: 100,
  courseId: 'c1',
  courseName: 'Theory',
  courseCode: 'CS401',
  course: {
    id: 'c1',
    name: 'Theory of Computation',
    code: 'CS401',
    isArchived: false,
    timezone: 'UTC',
  },
  allowLateSubmissions: false,
  lateCutoff: null,
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-02T00:00:00Z',
  problems: [
    { problem: p1, maxPoints: 10, maxSubmissions: 3, autograderEnabled: true },
    { problem: p2, maxPoints: 20, maxSubmissions: -1, autograderEnabled: false },
  ],
  ...over,
});

const initialAssignments = [
  { id: 'a1', title: 'Regular Languages' },
  { id: 'a2', title: 'Context-Free Grammars' },
];

/* ─────────────────────────── fetch router + render ──────────────────────── */

type Resp = { ok: boolean; status?: number; json: () => Promise<unknown> };
type Handlers = {
  shell: () => Resp | Promise<Resp>;
  courseProblems: () => Resp;
  assignmentsList: () => Resp;
  problemsMutation: (init?: RequestInit) => Resp;
  groups: () => Resp;
  groupProblems: () => Resp;
};

const courseProblemsList = [p1, p2, problem({ id: 'p3', title: 'Problem Three' })];

const defaultHandlers = (): Handlers => ({
  shell: () => ({ ok: true, json: async () => makeAssignment() }),
  courseProblems: () => ({ ok: true, json: async () => ({ problems: courseProblemsList }) }),
  assignmentsList: () => ({ ok: true, json: async () => initialAssignments }),
  problemsMutation: () => ({ ok: true, json: async () => ({}) }),
  groups: () => ({ ok: true, json: async () => ({ groups: [{ id: 'g1', name: 'Team A' }] }) }),
  groupProblems: () => ({
    ok: true,
    json: async () => ({ groups: [{ id: 'g1', problemIds: ['p1'] }] }),
  }),
});

let handlers: Handlers;
const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
  const u = String(url);
  if (u.includes('/group-problems')) return handlers.groupProblems();
  if (u.includes('/groups')) return handlers.groups();
  if (u.includes('/assignments/a1/problems')) return handlers.problemsMutation(init);
  if (u.includes('/assignments/a1')) return handlers.shell();
  if (u.includes('/assignments')) return handlers.assignmentsList();
  if (u.includes('view=problems')) return handlers.courseProblems();
  throw new Error(`Unexpected fetch: ${(init?.method ?? 'GET').toUpperCase()} ${u}`);
});

const renderView = (props: Record<string, unknown> = {}) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <PrivilegeAssignmentView
        initialAssignment={makeAssignment() as never}
        initialAssignments={initialAssignments}
        {...props}
      />
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  searchState.value = '';
  colParams.current = null;
  handlers = defaultHandlers();
  vi.stubGlobal('fetch', fetchMock);
});

/* ────────────────────────────────  tests  ───────────────────────────────── */

describe('PrivilegeAssignmentView — loading & not-found', () => {
  it('shows a loading spinner while the assignment shell is pending', () => {
    handlers.shell = () => new Promise<Resp>(() => {}); // never resolves
    renderView({ initialAssignment: null });
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
  });

  it('shows "Assignment not found." when the shell resolves with no assignment', async () => {
    handlers.shell = () => ({ ok: false, status: 500, json: async () => ({ error: 'boom' }) });
    renderView({ initialAssignment: null });
    expect(await screen.findByText('Assignment not found.')).toBeInTheDocument();
  });
});

describe('PrivilegeAssignmentView — header', () => {
  it('renders the assignment title and the course link', () => {
    renderView();
    // Title appears in the heading and as the selected assignment option.
    expect(screen.getAllByText('Regular Languages').length).toBeGreaterThan(0);
    const link = screen.getByRole('link', { name: /Theory of Computation \(CS401\)/ });
    expect(link).toHaveAttribute('href', '/dashboard/courses/c1');
  });

  it('renders the description', () => {
    renderView();
    expect(screen.getByText('Do the thing.')).toBeInTheDocument();
  });

  it('shows "No description." when the assignment has none', () => {
    renderView({ initialAssignment: makeAssignment({ description: null }) });
    expect(screen.getByText('No description.')).toBeInTheDocument();
  });
});

describe('PrivilegeAssignmentView — tabs', () => {
  it('defaults to the Description tab and shows the description', () => {
    renderView();
    expect(screen.getByText('Do the thing.')).toBeInTheDocument();
  });

  it('lists the assignment problems on the Problems tab', async () => {
    const user = userEvent.setup();
    renderView();
    await user.click(screen.getByRole('tab', { name: /Problems/ }));
    const table = screen.getByTestId('data-table');
    expect(within(table).getByText('Problem One')).toBeInTheDocument();
    expect(within(table).getByText('Problem Two')).toBeInTheDocument();
  });

  it('switches to Submissions, updating the URL and mounting AssignmentSubmissions', async () => {
    const user = userEvent.setup();
    renderView();
    await user.click(screen.getByRole('tab', { name: /Submissions/ }));
    expect(nav.replace).toHaveBeenCalledWith('?tab=submissions');
    const subs = screen.getByTestId('assignment-submissions');
    expect(subs).toHaveAttribute('data-course', 'c1');
    expect(subs).toHaveAttribute('data-assignment', 'a1');
  });

  it('honors an initial ?tab=submissions from the URL', () => {
    searchState.value = 'tab=submissions';
    renderView();
    expect(screen.getByTestId('assignment-submissions')).toBeInTheDocument();
  });
});

describe('PrivilegeAssignmentView — queries', () => {
  beforeEach(() => {
    searchState.value = 'tab=problems';
  });

  it('fetches the course problem pool for the picker on the Problems tab', async () => {
    renderView();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/courses/c1?view=problems'));
  });

  it('does not refetch the shell or the assignment list when seeded from SSR', async () => {
    renderView();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/courses/c1?view=problems'));
    const urls = fetchMock.mock.calls.map(([u]) => String(u));
    expect(urls.some((u) => u.includes('/assignments/a1?view=problems'))).toBe(false);
    expect(urls.some((u) => u.endsWith('/api/courses/c1/assignments'))).toBe(false);
  });

  it('feeds the fetched course-problem pool into the association dialog', async () => {
    renderView();
    // The button is disabled until the course-problems query settles.
    const addBtn = screen.getByRole('button', { name: 'Add Existing Problem' });
    await waitFor(() => expect(addBtn).toBeEnabled());
    fireEvent.click(addBtn);
    expect(await screen.findByText('picker-count:3')).toBeInTheDocument();
  });

  it('fetches groups and group-problem mappings for a group assignment', async () => {
    renderView({ initialAssignment: makeAssignment({ isGroup: true }) });
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/courses/c1/groups', expect.anything()),
    );
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/courses/c1/assignments/a1/group-problems',
        expect.anything(),
      ),
    );
  });
});

describe('PrivilegeAssignmentView — archived course', () => {
  beforeEach(() => {
    searchState.value = 'tab=problems';
  });

  it('hides the management buttons when the course is archived', () => {
    const { container } = renderView({
      initialAssignment: makeAssignment({
        course: { id: 'c1', name: 'Theory', code: 'CS401', isArchived: true, timezone: 'UTC' },
      }),
    });
    // `hidden` elements drop out of the a11y tree, so query the DOM directly.
    for (const label of ['Create Problem', 'Add Existing Problem']) {
      const btn = container.querySelector(`button[aria-label="${label}"]`);
      expect(btn).not.toBeNull();
      expect(btn).toHaveAttribute('hidden');
    }
  });
});

describe('PrivilegeAssignmentView — add problems', () => {
  beforeEach(() => {
    searchState.value = 'tab=problems';
  });

  it('POSTs the selected problems, toasts success, and refetches the assignment', async () => {
    renderView();
    const addBtn = screen.getByRole('button', { name: 'Add Existing Problem' });
    await waitFor(() => expect(addBtn).toBeEnabled());
    fireEvent.click(addBtn);
    fireEvent.click(await screen.findByRole('button', { name: 'assoc-add' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/courses/c1/assignments/a1/problems',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    const call = fetchMock.mock.calls.find(
      ([u, init]) =>
        String(u).endsWith('/assignments/a1/problems') && (init as RequestInit)?.method === 'POST',
    );
    expect(JSON.parse(String((call![1] as RequestInit).body))).toEqual({ problemIds: ['p9'] });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Problem Added'));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/courses/c1/assignments/a1?view=problems'),
    );
  });

  it('toasts an error when adding problems fails', async () => {
    handlers.problemsMutation = () => ({ ok: false, status: 500, json: async () => ({}) });
    renderView();
    const addBtn = screen.getByRole('button', { name: 'Add Existing Problem' });
    await waitFor(() => expect(addBtn).toBeEnabled());
    fireEvent.click(addBtn);
    fireEvent.click(await screen.findByRole('button', { name: 'assoc-add' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to add problems'));
  });
});

describe('PrivilegeAssignmentView — remove problem', () => {
  beforeEach(() => {
    searchState.value = 'tab=problems';
  });

  it('confirms, DELETEs, toasts success, and refetches', async () => {
    renderView();
    fireEvent.click(screen.getByRole('button', { name: 'remove-p1' }));

    const confirm = await screen.findByTestId('confirm-dialog');
    expect(confirm).toHaveTextContent('Problem One');
    fireEvent.click(within(confirm).getByRole('button', { name: 'confirm-remove' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/courses/c1/assignments/a1/problems',
        expect.objectContaining({ method: 'DELETE' }),
      ),
    );
    const call = fetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === 'DELETE');
    expect(JSON.parse(String((call![1] as RequestInit).body))).toEqual({ problemId: 'p1' });
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('"Problem One" removed from assignment'),
    );
  });

  it('toasts an error when removal fails', async () => {
    handlers.problemsMutation = () => ({ ok: false, status: 500, json: async () => ({}) });
    renderView();
    fireEvent.click(screen.getByRole('button', { name: 'remove-p1' }));
    fireEvent.click(
      within(await screen.findByTestId('confirm-dialog')).getByRole('button', {
        name: 'confirm-remove',
      }),
    );
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to remove "Problem One"'));
  });

  it('closes the confirm dialog without deleting on cancel', async () => {
    renderView();
    fireEvent.click(screen.getByRole('button', { name: 'remove-p1' }));
    fireEvent.click(
      within(await screen.findByTestId('confirm-dialog')).getByRole('button', {
        name: 'cancel-remove',
      }),
    );
    await waitFor(() => expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument());
    expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit)?.method === 'DELETE')).toBe(
      false,
    );
  });
});

describe('PrivilegeAssignmentView — render viewer', () => {
  beforeEach(() => {
    searchState.value = 'tab=problems';
  });

  it('opens the submission viewer with the solution file for a problem that has one', () => {
    renderView();
    fireEvent.click(screen.getByRole('button', { name: 'render-p1' }));
    const viewer = screen.getByTestId('viewer-dialog');
    expect(viewer).toHaveAttribute('data-src', '/api/files/solutions/sol1.jff');
    expect(viewer).toHaveAttribute('data-type', 'FA');
    expect(viewer).toHaveTextContent('orig1.jff - Problem One');
  });

  it('toasts an error and opens nothing when the problem has no file', () => {
    renderView();
    fireEvent.click(screen.getByRole('button', { name: 'render-p2' }));
    expect(toast.error).toHaveBeenCalledWith('No file available to render');
    expect(screen.queryByTestId('viewer-dialog')).not.toBeInTheDocument();
  });
});

describe('PrivilegeAssignmentView — description & edit dialogs', () => {
  beforeEach(() => {
    searchState.value = 'tab=problems';
  });

  it('opens the description dialog with the problem description', async () => {
    renderView();
    fireEvent.click(screen.getByRole('button', { name: 'desc-p1' }));
    expect(await screen.findByText('Problem Description')).toBeInTheDocument();
    expect(screen.getByText('Desc one')).toBeInTheDocument();
  });

  it('opens the edit-problem dialog with the course id injected', () => {
    renderView();
    fireEvent.click(screen.getByRole('button', { name: 'edit-p1' }));
    const dialog = screen.getByTestId('edit-problem-dialog');
    expect(dialog).toHaveAttribute('data-problem-id', 'p1');
    expect(dialog).toHaveAttribute('data-course-id', 'c1');
  });

  it('opens the Settings tab from the tab bar', async () => {
    const user = userEvent.setup();
    renderView();
    await user.click(screen.getByRole('tab', { name: /Settings/ }));
    expect(await screen.findByTestId('assignment-settings')).toBeInTheDocument();
  });

  it('opens the create-problem dialog from the header button', async () => {
    renderView();
    const createBtn = screen.getByRole('button', { name: 'Create Problem' });
    await waitFor(() => expect(createBtn).toBeEnabled());
    fireEvent.click(createBtn);
    expect(screen.getByTestId('create-dialog')).toBeInTheDocument();
  });
});

describe('PrivilegeAssignmentView — assignment switcher', () => {
  it('navigates to the chosen assignment', () => {
    renderView();
    fireEvent.change(screen.getByLabelText('Assignment'), { target: { value: 'a2' } });
    expect(nav.push).toHaveBeenCalledWith('/dashboard/courses/c1/a2');
  });

  it('toasts and does not navigate when the selected assignment is unknown', () => {
    renderView();
    // The empty option resolves to no assignment in allAssignments.
    fireEvent.change(screen.getByLabelText('Assignment'), { target: { value: '' } });
    expect(toast.error).toHaveBeenCalledWith('Selected assignment not found');
    expect(nav.push).not.toHaveBeenCalled();
  });
});
