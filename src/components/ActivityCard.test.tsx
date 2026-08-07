/** @vitest-environment jsdom */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ActivityCard } from './ActivityCard';
import type { ActivityLog } from '@/app/dashboard/courses/[id]/activity-columns';

// Fresh QueryClient per test (retry off, no lingering cache) so each activity
// query starts cold.
const renderWithClient = (ui: React.ReactElement) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
};

// Timezone hook hits the network in real life; stub it to a fixed value.
vi.mock('@/hooks/use-effective-timezone', () => ({
  useEffectiveTimezone: () => ({ timezone: 'UTC', loading: false }),
}));

// The column factory pulls in table/date machinery we don't need here.
vi.mock('@/app/dashboard/courses/[id]/activity-columns', () => ({
  getActivityColumns: vi.fn(() => []),
}));

// Render rows minimally so we can assert on row count / content. Loading is now
// the table's job (the card no longer renders its own spinner), so the stub has
// to honour it for the loading assertion to mean anything.
vi.mock('@/components/ui/data-table', () => ({
  DataTable: ({
    data,
    loading,
    loadingMessage,
    rowCount,
    showExportButton,
    onPaginationChange,
    pagination,
  }: {
    data: ActivityLog[];
    loading?: boolean;
    loadingMessage?: string;
    rowCount?: number;
    showExportButton?: boolean;
    onPaginationChange?: (u: { pageIndex: number; pageSize: number }) => void;
    pagination?: { pageIndex: number; pageSize: number };
  }) =>
    loading ? (
      <div>{loadingMessage}</div>
    ) : (
      <div>
        <div data-testid="table-rows">{data.length}</div>
        <div data-testid="row-count">{String(rowCount)}</div>
        <div data-testid="export-shown">{String(showExportButton !== false)}</div>
        <button
          type="button"
          onClick={() =>
            onPaginationChange?.({
              pageIndex: (pagination?.pageIndex ?? 0) + 1,
              pageSize: pagination?.pageSize ?? 50,
            })
          }
        >
          next page
        </button>
        <ul>
          {data.map((a) => (
            <li key={a.id}>{a.action}</li>
          ))}
        </ul>
      </div>
    ),
}));

vi.mock('@/lib/toast', () => import('@/test/mocks/toast').then((m) => m.toastModuleMock));

const activity = (id: string, action: string): ActivityLog =>
  ({ id, action }) as unknown as ActivityLog;

const jsonResponse = (body: unknown) => ({ ok: true, json: async () => body });

/** Serve the filter-options request and the page request from one fetch mock. */
const installFetch = (page: { rows: ActivityLog[]; total: number }) => {
  const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
  fetchMock.mockImplementation(async (url: string) =>
    String(url).includes('part=filters')
      ? jsonResponse({ assignments: [], problems: [] })
      : jsonResponse(page),
  );
  return fetchMock;
};

/** The URL of the most recent page (non-filters) request. */
const lastPageUrl = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls
    .map(([u]) => String(u))
    .filter((u) => !u.includes('part=filters'))
    .pop() ?? '';

describe('ActivityCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  it('fetches the first page on mount and renders its rows', async () => {
    const fetchMock = installFetch({
      rows: [activity('a1', 'ENROLLED'), activity('a2', 'GRADED')],
      total: 2,
    });

    renderWithClient(<ActivityCard courseId="course-1" />);

    await waitFor(() => {
      expect(screen.getByTestId('table-rows').textContent).toBe('2');
    });

    expect(lastPageUrl(fetchMock)).toContain('page=1');
    expect(lastPageUrl(fetchMock)).toContain('pageSize=50');
    expect(screen.getByText('ENROLLED')).toBeInTheDocument();
    expect(screen.getByText('GRADED')).toBeInTheDocument();
  });

  it('reports the server total rather than the rows on screen', async () => {
    installFetch({ rows: [activity('a1', 'ENROLLED')], total: 1200 });

    renderWithClient(<ActivityCard courseId="course-1" />);

    await waitFor(() => expect(screen.getByTestId('row-count').textContent).toBe('1200'));
    // The heading badge counts the whole log, not the one row on screen.
    expect(screen.getByRole('heading', { name: /Activity/ })).toHaveTextContent('1200');
  });

  it('offers no CSV export, because the browser only holds one page', async () => {
    installFetch({ rows: [activity('a1', 'ENROLLED')], total: 1 });

    renderWithClient(<ActivityCard courseId="course-1" />);

    await waitFor(() => expect(screen.getByTestId('export-shown').textContent).toBe('false'));
  });

  it('shows the loading state before the first page resolves', () => {
    // Never resolves, keeps the query in its initial loading state.
    (global.fetch as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {}));

    renderWithClient(<ActivityCard courseId="course-1" />);

    expect(screen.getByText('Loading activity, please wait...')).toBeInTheDocument();
  });

  it('asks the server for the next page instead of accumulating', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockImplementation(async (url: string) => {
      const u = String(url);
      if (u.includes('part=filters')) return jsonResponse({ assignments: [], problems: [] });
      return jsonResponse({
        rows: u.includes('page=2') ? [activity('a3', 'THIRD')] : [activity('a1', 'FIRST')],
        total: 3,
      });
    });

    renderWithClient(<ActivityCard courseId="course-1" />);
    await waitFor(() => expect(screen.getByText('FIRST')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'next page' }));

    await waitFor(() => expect(screen.getByText('THIRD')).toBeInTheDocument());
    // The page replaces rather than accumulating: one page is held at a time.
    expect(screen.getByTestId('table-rows').textContent).toBe('1');
    expect(screen.queryByText('FIRST')).toBeNull();
    expect(lastPageUrl(fetchMock)).toContain('page=2');
  });

  it('keeps the current page on screen while the next one loads', async () => {
    // keepPreviousData is only worth having if the table is not told it is loading on
    // every page change; driving `loading` from isFetching would undo it.
    const fetchMock = installFetch({ rows: [activity('a1', 'FIRST')], total: 100 });

    renderWithClient(<ActivityCard courseId="course-1" />);
    await waitFor(() => expect(screen.getByText('FIRST')).toBeInTheDocument());

    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes('part=filters'))
        return jsonResponse({ assignments: [], problems: [] });
      await gate;
      return jsonResponse({ rows: [activity('a2', 'SECOND')], total: 100 });
    });

    fireEvent.click(screen.getByRole('button', { name: 'next page' }));

    // The previous page's row stays put rather than being replaced by the placeholder.
    await waitFor(() => expect(lastPageUrl(fetchMock)).toContain('page=2'));
    expect(screen.getByText('FIRST')).toBeInTheDocument();
    expect(screen.queryByText('Loading activity, please wait...')).toBeNull();

    release?.();
  });

  it('has no Load More button', async () => {
    installFetch({ rows: [activity('a1', 'FIRST')], total: 100 });

    renderWithClient(<ActivityCard courseId="course-1" />);
    await waitFor(() => expect(screen.getByText('FIRST')).toBeInTheDocument());

    expect(screen.queryByRole('button', { name: 'Load More' })).not.toBeInTheDocument();
  });
});
