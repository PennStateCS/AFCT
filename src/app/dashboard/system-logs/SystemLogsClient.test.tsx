/** @vitest-environment jsdom */

import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SystemLogsClient from './SystemLogsClient';

// SystemLogsClient relies on the classic JSX runtime (React.createElement) but
// does not import React itself, so expose it globally for the component.
vi.stubGlobal('React', React);

// Render with a fresh QueryClient per test (retry off, no lingering cache) so the
// logs query starts clean each time.
const renderWithClient = (ui: React.ReactElement) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
};

// Shape returned by GET /api/admin/logs and rendered by the table.
type LogRow = {
  id: string;
  timestamp: string;
  userId: string | null;
  userFirstName: string | null;
  userLastName: string | null;
  action: string;
  category: string | null;
  severity: 'INFO' | 'WARNING' | 'ERROR' | 'SECURITY';
  ipAddress?: string | null;
};

// Lightweight DataTable mock: renders each row's rendered cells so we can assert
// on real column output, and exposes buttons/inputs to drive pagination and the
// global (search) filter: the two callbacks the component wires up.
vi.mock('@/components/ui/data-table', () => ({
  DataTable: ({
    columns,
    data,
    loading,
    pagination,
    onPaginationChange,
    globalFilter,
    onGlobalFilterChange,
    actionButtons,
  }: {
    columns: Array<{
      id?: string;
      accessorKey?: string;
      cell?: (ctx: { getValue: () => unknown; row: { original: LogRow } }) => React.ReactNode;
    }>;
    data: LogRow[];
    loading?: boolean;
    pagination: { pageIndex: number; pageSize: number };
    onPaginationChange: (next: { pageIndex: number; pageSize: number }) => void;
    globalFilter: string;
    onGlobalFilterChange: (v: string) => void;
    actionButtons?: React.ReactNode;
  }) => (
    <div>
      <div data-testid="table-loading">{String(!!loading)}</div>
      <div data-testid="table-rows">{data.length}</div>
      <div data-testid="page-index">{pagination.pageIndex}</div>
      <table>
        <tbody>
          {data.map((row) => (
            <tr key={row.id} data-testid="log-row">
              {columns.map((col) => {
                const key = col.id ?? col.accessorKey ?? '';
                const getValue = () =>
                  col.accessorKey ? (row as Record<string, unknown>)[col.accessorKey] : undefined;
                return <td key={key}>{col.cell ? col.cell({ getValue, row: { original: row } }) : null}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <button
        type="button"
        onClick={() =>
          onPaginationChange({ pageIndex: pagination.pageIndex + 1, pageSize: pagination.pageSize })
        }
      >
        Next Page
      </button>
      <input
        aria-label="search-input"
        value={globalFilter}
        onChange={(e) => onGlobalFilterChange(e.target.value)}
      />
      {actionButtons}
    </div>
  ),
}));

// Dialogs are irrelevant to fetch/render behavior; stub them out.
vi.mock('@/components/dialogs/LogViewerDialog', () => ({
  LogViewerDialog: () => null,
}));
vi.mock('@/components/dialogs/DownloadLogsDialog', () => ({
  DownloadLogsDialog: () => null,
}));

const makeRow = (over: Partial<LogRow> = {}): LogRow => ({
  id: 'log1',
  timestamp: '2026-01-01T00:00:00.000Z',
  userId: 'u1',
  userFirstName: 'Ada',
  userLastName: 'Lovelace',
  action: 'USER_LOGIN',
  category: 'AUTH',
  severity: 'INFO',
  ipAddress: '1.2.3.4',
  ...over,
});

// Pull the URL string out of the most recent fetch call.
const lastFetchUrl = () => {
  const mock = global.fetch as ReturnType<typeof vi.fn>;
  const call = mock.mock.calls[mock.mock.calls.length - 1];
  return String(call[0]);
};

describe('SystemLogsClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fetches logs on mount and renders returned rows', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ rows: [makeRow({ action: 'USER_LOGIN' })], total: 1 }),
    });

    renderWithClient(<SystemLogsClient />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });

    expect(lastFetchUrl()).toContain('/api/admin/logs?');
    await waitFor(() => {
      expect(screen.getByTestId('table-rows').textContent).toBe('1');
    });
    // Action cell replaces underscores with spaces.
    expect(screen.getByText('USER LOGIN')).toBeInTheDocument();
    expect(screen.getByText('Lovelace')).toBeInTheDocument();
  });

  it('shows a loading state before the first fetch resolves', () => {
    // fetch never resolves -> query stays pending.
    (global.fetch as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {}));

    renderWithClient(<SystemLogsClient />);

    expect(screen.getByTestId('table-loading').textContent).toBe('true');
    expect(screen.getByTestId('table-rows').textContent).toBe('0');
  });

  it('issues a fetch with the next page param when pagination changes', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ rows: [makeRow()], total: 50 }),
    });

    renderWithClient(<SystemLogsClient />);

    await waitFor(() => {
      expect(lastFetchUrl()).toContain('page=1');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Next Page' }));

    await waitFor(() => {
      expect(lastFetchUrl()).toContain('page=2');
    });
  });

  it('issues a fetch whose URL includes the debounced search term', async () => {
    vi.useFakeTimers();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ rows: [makeRow()], total: 1 }),
    });

    renderWithClient(<SystemLogsClient />);

    // Let the initial mount query run.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    fireEvent.change(screen.getByLabelText('search-input'), { target: { value: 'login' } });

    // Debounce is 300ms; advance past it and flush the debounce timer + the
    // resulting query. waitFor is avoided here because it schedules on real
    // timers and would deadlock against the fake clock.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });

    expect(lastFetchUrl()).toContain('q=login');
  });
});
