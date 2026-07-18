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

const toastError = vi.hoisted(() => vi.fn());

vi.mock('@/lib/toast', () => ({
  showToast: { error: toastError, success: vi.fn() },
}));

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { isAdmin: false } } }),
}));

vi.mock('@/hooks/use-effective-timezone', () => ({
  useEffectiveTimezone: () => ({ timezone: 'UTC' }),
}));

vi.mock('@/lib/date', () => ({
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
    columns: Array<{ id?: string; accessorKey?: string; header?: unknown; cell?: (ctx: unknown) => React.ReactNode }>;
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
      expect(global.fetch).toHaveBeenCalledWith('/api/courses/c1/grades');
      expect(screen.getByTestId('table-rows').textContent).toBe('2');
    });

    // Student names and the graded cell (8/10) come from the derived matrix.
    expect(screen.getByText('Ada')).toBeInTheDocument();
    expect(screen.getByText('Turing')).toBeInTheDocument();
    expect(screen.getByText('8')).toBeInTheDocument();
    // maxPoints "/10" renders for every student cell in the assignment column.
    expect(screen.getAllByText('/10').length).toBe(2);
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

  it('renders a gray "Not assigned" box for unassigned cells and a normal grade otherwise', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        ...gradesPayload,
        // s1 is assigned a1 (normal cell); s2 is not assigned (gray box).
        assigned: {
          s1: { a1: true },
          s2: { a1: false },
        },
      }),
    });

    renderWithClient(<PrivilegeGradesCard courseId="c1" />);

    // The unassigned cell renders exactly one gray box.
    const notAssigned = await screen.findAllByLabelText('Not assigned');
    expect(notAssigned).toHaveLength(1);

    // The assigned cell renders its grade normally (8/10), and the gray box has no grade.
    expect(screen.getByText('8')).toBeInTheDocument();
    expect(screen.getAllByText('/10')).toHaveLength(1);
  });

  it('surfaces an error toast when the fetch fails', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'boom' }),
    });

    renderWithClient(<PrivilegeGradesCard courseId="c1" />);

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith('Failed to load grades');
    });
    expect(screen.getByTestId('table-rows').textContent).toBe('0');
  });
});
