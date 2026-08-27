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
  userEmail: string | null;
  action: string;
  category: string | null;
  severity: 'INFO' | 'WARNING' | 'ERROR' | 'SECURITY';
  ipAddress?: string | null;
  userAgent?: string | null;
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
                return (
                  <td key={key}>
                    {col.cell ? col.cell({ getValue, row: { original: row } }) : null}
                  </td>
                );
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
// Rendered as a marker when open rather than always null: the point of the row action is that
// it opens this, and a mock that swallows `open` cannot tell a working button from a dead one.
vi.mock('@/components/dialogs/LogViewerDialog', () => ({
  LogViewerDialog: ({ open }: { open?: boolean }) =>
    open ? <div data-testid="log-viewer" /> : null,
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
  userEmail: 'ada@example.com',
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
    // The Action cell shows the display verb. The stored USER_LOGIN is what the row is
    // filtered, searched and exported by, and it is untouched. Upper-cased in CSS, so the text
    // node stays in ordinary case and Copy JSON carries the entry as stored.
    expect(screen.getByText('Signed in')).toHaveClass('uppercase');
    // One Name column, surname first: "Lovelace, Ada". Upper-cased in CSS, so the text node
    // itself stays in ordinary case and this asserts what a screen reader hears.
    expect(screen.getByText('Lovelace, Ada')).toBeInTheDocument();
    // The address under it, which is what tells two people of the same name apart.
    expect(screen.getByText('ada@example.com')).toBeInTheDocument();
  });

  /*
   * One width for every badge in the Severity and Category columns.
   *
   * The point is the column's edges lining up, so the width has to be on the badge itself and
   * the label has to stay centred inside it. Badge is a centred flex box by default, and the
   * failure mode is somebody "simplifying" the fixed width onto the cell instead, where the
   * badge would go back to hugging its text.
   */
  it('gives the badges one width each, with the label still centred', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        rows: [makeRow({ severity: 'SECURITY', category: 'ASSIGNMENT' })],
        total: 1,
      }),
    });

    renderWithClient(<SystemLogsClient />);

    const severity = await screen.findByText('SECURITY');
    const category = await screen.findByText('ASSIGNMENT');

    // A minimum, not a fixed width: the column still lines up, and a label that would not
    // fit grows the badge instead of being clipped inside its overflow-hidden.
    expect(severity).toHaveClass('min-w-20');
    expect(category).toHaveClass('min-w-24');
    // Badge's own centring, which the width would otherwise leave the text sitting left of.
    expect(severity).toHaveClass('justify-center');
    expect(category).toHaveClass('justify-center');
  });

  /*
   * The per-row action is an icon, so its accessible name is the only thing carrying it: the
   * tooltip is not a name, and a page of buttons that all say the same thing is what a screen
   * reader would otherwise read out. That is the part worth pinning, along with the old solid
   * "Full Log" button being gone, since bringing it back is a one-line mistake.
   */
  it('opens the full log from a named icon action, not a row of solid buttons', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ rows: [makeRow({ action: 'USER_LOGIN' })], total: 1 }),
    });

    renderWithClient(<SystemLogsClient />);

    await waitFor(() => {
      expect(screen.getByTestId('table-rows').textContent).toBe('1');
    });

    expect(screen.queryByRole('button', { name: 'Full Log' })).not.toBeInTheDocument();

    // Named after the row it belongs to, not just "View full log".
    const action = screen.getByRole('button', { name: /^View full log for Signed in at / });
    fireEvent.click(action);

    expect(screen.getByTestId('log-viewer')).toBeInTheDocument();
  });

  /*
   * The address alone rarely answers "was that really them". The same address from a phone
   * rather than the lab machine often does, so the browser and platform sit under it.
   */
  it('puts the browser and platform under the address', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        rows: [
          makeRow({
            ipAddress: '::ffff:1.2.3.4',
            userAgent:
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0',
          }),
        ],
        total: 1,
      }),
    });

    renderWithClient(<SystemLogsClient />);

    // The IPv4-mapped IPv6 prefix is still stripped.
    expect(await screen.findByText('1.2.3.4')).toBeInTheDocument();
    expect(screen.getByText('Edge on Windows')).toBeInTheDocument();
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
