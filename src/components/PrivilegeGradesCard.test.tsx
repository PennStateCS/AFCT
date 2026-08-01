/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PrivilegeGradesCard } from './PrivilegeGradesCard';

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
  }: {
    columns: Array<{
      id?: string;
      accessorKey?: string;
      header?: unknown;
      cell?: (ctx: unknown) => React.ReactNode;
    }>;
    data: Array<Record<string, unknown>>;
    loading?: boolean;
  }) => (
    <div>
      <div data-testid="table-loading">{String(!!loading)}</div>
      <div data-testid="table-rows">{data.length}</div>
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

const gradesPayload = {
  students: [
    { id: 's1', email: 'ada@x.io', firstName: 'Ada', lastName: 'Lovelace' },
    { id: 's2', email: 'alan@x.io', firstName: 'Alan', lastName: 'Turing' },
  ],
  assignments: [{ id: 'a1', title: 'Homework 1', maxPoints: 10 }],
  grades: {
    s1: { a1: 8 },
    s2: { a1: null },
  },
};

describe('PrivilegeGradesCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  it('fetches the grades matrix on mount and renders it', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => gradesPayload,
    });

    renderWithClient(<PrivilegeGradesCard courseId="c1" />);

    await waitFor(() => {
      // The gradebook loads its structure and grade values in two requests.
      expect(global.fetch).toHaveBeenCalledWith('/api/courses/c1/grades?part=structure');
      expect(global.fetch).toHaveBeenCalledWith('/api/courses/c1/grades?part=values');
      expect(screen.getByTestId('table-rows').textContent).toBe('2');
    });

    // Student names and the graded cell come from the derived matrix. Cells show only
    // the earned grade, formatted to two decimals (the points live in the header).
    expect(screen.getByText('Ada')).toBeInTheDocument();
    expect(screen.getByText('Turing')).toBeInTheDocument();
    expect(screen.getByText('8.00')).toBeInTheDocument();
    expect(screen.queryByText('/10')).toBeNull();

    // Leading columns are avatar, then Last Name, then First Name.
    const leadCols = Array.from(document.querySelectorAll('[data-col]'))
      .map((el) => el.getAttribute('data-col'))
      .filter((c) => c === 'avatar' || c === 'lastName' || c === 'firstName')
      .slice(0, 3);
    expect(leadCols).toEqual(['avatar', 'lastName', 'firstName']);
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

    resolveFetch({ ok: true, json: async () => gradesPayload });

    await waitFor(() => {
      expect(screen.getByTestId('table-loading').textContent).toBe('false');
    });
  });

  it('renders "N/A" for unassigned cells and a normal grade otherwise', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        ...gradesPayload,
        // s1 is assigned a1 (normal cell); s2 is not assigned (N/A).
        assigned: {
          s1: { a1: true },
          s2: { a1: false },
        },
      }),
    });

    renderWithClient(<PrivilegeGradesCard courseId="c1" />);

    // The unassigned cell renders exactly one "Not assigned" (N/A) marker.
    const notAssigned = await screen.findAllByLabelText('Not assigned');
    expect(notAssigned).toHaveLength(1);
    expect(notAssigned[0]).toHaveTextContent('N/A');

    // The assigned cell renders its grade (two decimals).
    expect(screen.getByText('8.00')).toBeInTheDocument();
  });

  it('orders the assignment columns by due date, earliest first', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        students: [{ id: 's1', email: 'ada@x.io', firstName: 'Ada', lastName: 'Lovelace' }],
        assignments: [
          { id: 'late', title: 'Late', maxPoints: 10, dueDate: '2026-03-01T00:00:00Z' },
          { id: 'early', title: 'Early', maxPoints: 10, dueDate: '2026-01-01T00:00:00Z' },
          { id: 'nodue', title: 'No due date', maxPoints: 10 },
        ],
        grades: { s1: {} },
      }),
    });

    renderWithClient(<PrivilegeGradesCard courseId="c1" />);
    await waitFor(() => expect(screen.getByTestId('table-rows').textContent).toBe('1'));

    const assignmentCols = Array.from(document.querySelectorAll('[data-col]'))
      .map((el) => el.getAttribute('data-col'))
      .filter((c) => c === 'early' || c === 'late' || c === 'nodue');
    // Earliest due date first; the assignment with no due date sorts to the end.
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
