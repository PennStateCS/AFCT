/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PrivilegeGradesCard } from './PrivilegeGradesCard';
import type { GradePageRow } from '@/lib/course-grades';

// Fresh QueryClient per test (retry off, no lingering cache) so each grades
// query starts cold.
const renderWithClient = (ui: React.ReactElement) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
};

import { toastMock } from '@/test/mocks/toast';

vi.mock('@/lib/toast', () => import('@/test/mocks/toast').then((m) => m.toastModuleMock));
const toastError = toastMock.error;

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { isAdmin: false } } }),
}));

vi.mock('@/hooks/use-effective-timezone', () => ({
  useEffectiveTimezone: () => ({ timezone: 'UTC' }),
}));

vi.mock('@/lib/date-format', () => ({
  formatTimeInTimeZone: () => 'now',
}));

vi.mock('@/components/dialogs/GradeBreakdownDialog', () => ({
  GradeBreakdownDialog: () => null,
}));

vi.mock('@/components/dialogs/GradesLmsExportDialog', () => ({
  GradesLmsExportDialog: () => null,
}));

// Light DataTable stub: render each row's cells so we can assert the matrix
// content, plus loading state and row count.
vi.mock('@/components/ui/data-table', () => ({
  DataTable: ({
    columns,
    data,
    loading,
    onGlobalFilterChange,
    onPaginationChange,
    pagination,
  }: {
    columns: Array<{
      id?: string;
      accessorKey?: string;
      header?: unknown;
      cell?: (ctx: unknown) => React.ReactNode;
    }>;
    data: Array<Record<string, unknown>>;
    loading?: boolean;
    onGlobalFilterChange?: (v: string) => void;
    onPaginationChange?: (u: { pageIndex: number; pageSize: number }) => void;
    pagination?: { pageIndex: number; pageSize: number };
  }) => (
    <div>
      <div data-testid="table-loading">{String(!!loading)}</div>
      <div data-testid="table-rows">{data.length}</div>
      <input data-testid="global-filter" onChange={(e) => onGlobalFilterChange?.(e.target.value)} />
      <button
        type="button"
        onClick={() =>
          onPaginationChange?.({
            pageIndex: (pagination?.pageIndex ?? 0) + 1,
            pageSize: pagination?.pageSize ?? 10,
          })
        }
      >
        next page
      </button>
      <ul>
        {data.map((row, i) => (
          <li key={String(row.id ?? i)}>
            {columns.map((col, ci) => (
              <span key={col.id ?? col.accessorKey ?? ci} data-col={col.id ?? col.accessorKey}>
                {col.cell ? col.cell({ row: { original: row } }) : null}
              </span>
            ))}
          </li>
        ))}
      </ul>
    </div>
  ),
}));

// The two payloads the gradebook now fetches: columns once, then a page of students
// whose rows already carry their own assigned flags and grades.
const columnsPayload = {
  assignments: [{ id: 'a1', title: 'Homework 1', maxPoints: 10, isPublished: true }],
  totalStudents: 2,
};

/*
 * Typed as the server's own row so a field rename in `lib/course-grades` breaks this test
 * at compile time rather than silently rendering blank cells. The roster shipped exactly
 * that bug: the server spelled a field one way and the columns read another.
 */
const row = (over: Partial<GradePageRow> = {}): GradePageRow => ({
  id: 's1',
  email: 'ada@x.io',
  firstName: 'Ada',
  lastName: 'Lovelace',
  avatar: null,
  cropX: null,
  cropY: null,
  zoom: null,
  enrollmentStatus: 'ENROLLED',
  assigned: { a1: true },
  grades: { a1: 8 },
  ...over,
});

const pagePayload = {
  rows: [
    row(),
    row({
      id: 's2',
      email: 'alan@x.io',
      firstName: 'Alan',
      lastName: 'Turing',
      grades: { a1: null },
    }),
  ],
  total: 2,
};

/** A gradebook with a draft sitting in it, which is most gradebooks mid-term. */
const withDraftPayload = {
  assignments: [
    { id: 'a1', title: 'Homework 1', maxPoints: 10, isPublished: true },
    { id: 'draft', title: 'Homework 2', maxPoints: 10, isPublished: false },
  ],
  totalStudents: 1,
};

/** Serve the columns request and the page request from one fetch mock. */
const installFetch = (page: unknown = pagePayload, columns: unknown = columnsPayload) => {
  const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
  fetchMock.mockImplementation(async (url: string) =>
    String(url).includes('part=columns')
      ? { ok: true, json: async () => columns }
      : { ok: true, json: async () => page },
  );
  return fetchMock;
};

describe('PrivilegeGradesCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  it('keeps a draft out of the Average, and says so on its column', async () => {
    // Full marks on the work that is out, nothing on the draft. Counting the draft would
    // report this student at 50% for work they have never been able to see.
    installFetch(
      {
        rows: [row({ assigned: { a1: true, draft: true }, grades: { a1: 10, draft: null } })],
        total: 1,
      },
      withDraftPayload,
    );

    renderWithClient(<PrivilegeGradesCard courseId="c1" />);

    await waitFor(() => expect(screen.getByTestId('table-rows').textContent).toBe('1'));

    const average = document.querySelector('[data-col="totalGrade"]');
    expect(average?.textContent).toContain('100.00%');
    expect(average?.textContent).toContain('10/10');
  });

  it('fetches the columns and one page of students, and renders them', async () => {
    const fetchMock = installFetch();

    renderWithClient(<PrivilegeGradesCard courseId="c1" />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/courses/c1/grades?part=columns');
      expect(screen.getByTestId('table-rows').textContent).toBe('2');
    });

    // The rows come from a paged request, not a whole-course matrix.
    const urls = fetchMock.mock.calls.map(([u]) => String(u));
    expect(urls.some((u) => u.includes('page=1') && u.includes('pageSize=10'))).toBe(true);

    // Student names and the graded cell come from the derived matrix. Cells show only
    // the earned grade, formatted to two decimals (the points live in the header).
    // One name column, last name first, which is the order the table is sorted in.
    expect(screen.getByText('Lovelace, Ada')).toBeInTheDocument();
    expect(screen.getByText('Turing, Alan')).toBeInTheDocument();
    expect(screen.getByText('8.00')).toBeInTheDocument();
    expect(screen.queryByText('/10')).toBeNull();

    // The matrix leads with the name. No separate first-name column: it cost width that
    // every assignment column needs, in a table that is already mostly columns. And no
    // avatar column, because a photo says nothing about a grade.
    const cols = Array.from(document.querySelectorAll('[data-col]')).map((el) =>
      el.getAttribute('data-col'),
    );
    expect(cols[0]).toBe('lastName');
    expect(cols).not.toContain('firstName');
    expect(document.querySelector('[data-col="avatar"]')).toBeNull();
  });

  /*
   * The column id is still `lastName`, and that is load-bearing rather than leftover:
   * sorting is the server's, and its `lastName` order is last name, then first name, then
   * user id, which is exactly what this column shows. A prettier id would have to be added
   * to the API's allowlist first, and until it was, sorting would silently fall back.
   */
  it('sorts the combined column on the server, by last name then first', async () => {
    const fetchMock = installFetch();
    renderWithClient(<PrivilegeGradesCard courseId="c1" />);
    await waitFor(() => expect(screen.getByTestId('table-rows').textContent).toBe('2'));

    const urls = fetchMock.mock.calls.map(([u]) => String(u));
    expect(urls.some((u) => u.includes('sortBy=lastName'))).toBe(true);
  });

  it('keeps the current page on screen while the next one loads', async () => {
    // keepPreviousData is only worth having if the table is not told it is loading on
    // every page change; driving `loading` from isFetching would undo it.
    const fetchMock = installFetch();

    renderWithClient(<PrivilegeGradesCard courseId="c1" />);
    await waitFor(() => expect(screen.getByTestId('table-rows').textContent).toBe('2'));

    // Hold the next page in flight.
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes('part=columns'))
        return { ok: true, json: async () => columnsPayload };
      await gate;
      return { ok: true, json: async () => pagePayload };
    });

    fireEvent.click(screen.getByRole('button', { name: 'next page' }));

    // The previous page's rows stay put, and the table is not put into its loading state.
    await waitFor(() => expect(screen.getByTestId('table-loading').textContent).toBe('false'));
    expect(screen.getByTestId('table-rows').textContent).toBe('2');

    release?.();
  });

  it('shows the loading state before the fetch resolves', async () => {
    let resolveFetch: (v: unknown) => void = () => {};
    (global.fetch as ReturnType<typeof vi.fn>).mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );

    renderWithClient(<PrivilegeGradesCard courseId="c1" />);

    // While the query is pending the table reports loading and has no rows.
    expect(screen.getByTestId('table-loading').textContent).toBe('true');
    expect(screen.getByTestId('table-rows').textContent).toBe('0');

    resolveFetch({ ok: true, json: async () => pagePayload });

    await waitFor(() => {
      expect(screen.getByTestId('table-loading').textContent).toBe('false');
    });
  });

  it('renders "N/A" for unassigned cells and a normal grade otherwise', async () => {
    installFetch({
      rows: [
        // s1 is assigned a1 (normal cell); s2 is not assigned (N/A).
        row(),
        row({ id: 's2', email: 'alan@x.io', assigned: { a1: false }, grades: { a1: null } }),
      ],
      total: 2,
    });

    renderWithClient(<PrivilegeGradesCard courseId="c1" />);

    // The unassigned cell renders exactly one "Not assigned" (N/A) marker.
    const notAssigned = await screen.findAllByLabelText('Not assigned');
    expect(notAssigned).toHaveLength(1);
    expect(notAssigned[0]).toHaveTextContent('N/A');

    // The assigned cell renders its grade (two decimals).
    expect(screen.getByText('8.00')).toBeInTheDocument();
  });

  it('renders one column per assignment, in the order the server sent them', async () => {
    installFetch(
      { rows: [row({ assigned: {}, grades: {} })], total: 1 },
      {
        // The server orders by due date; the client no longer re-sorts.
        assignments: [
          { id: 'early', title: 'Early', maxPoints: 10, dueDate: '2026-01-01T00:00:00Z' },
          { id: 'late', title: 'Late', maxPoints: 10, dueDate: '2026-03-01T00:00:00Z' },
          { id: 'nodue', title: 'No due date', maxPoints: 10 },
        ],
        totalStudents: 1,
      },
    );

    renderWithClient(<PrivilegeGradesCard courseId="c1" />);
    await waitFor(() => expect(screen.getByTestId('table-rows').textContent).toBe('1'));

    const assignmentCols = Array.from(document.querySelectorAll('[data-col]'))
      .map((el) => el.getAttribute('data-col'))
      .filter((c) => c === 'early' || c === 'late' || c === 'nodue');
    expect(assignmentCols).toEqual(['early', 'late', 'nodue']);
  });

  it('surfaces an error toast when the fetch fails', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'boom' }),
    });

    renderWithClient(<PrivilegeGradesCard courseId="c1" />);

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith(
        'Could not load grades. Refresh the page to try again.',
      );
    });
    expect(screen.getByTestId('table-rows').textContent).toBe('0');
  });
});
