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
  }: {
    data: ActivityLog[];
    loading?: boolean;
    loadingMessage?: string;
  }) =>
    loading ? (
      <div>{loadingMessage}</div>
    ) : (
      <div>
        <div data-testid="table-rows">{data.length}</div>
        <ul>
          {data.map((a) => (
            <li key={a.id}>{a.action}</li>
          ))}
        </ul>
      </div>
    ),
}));

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

const activity = (id: string, action: string): ActivityLog =>
  ({ id, action }) as unknown as ActivityLog;

const jsonResponse = (body: unknown) => ({ ok: true, json: async () => body });

describe('ActivityCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  it('fetches the first page on mount and renders its rows', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({
        activities: [activity('a1', 'ENROLLED'), activity('a2', 'GRADED')],
        totalCount: 2,
        hasMore: false,
      }),
    );

    renderWithClient(<ActivityCard courseId="course-1" />);

    await waitFor(() => {
      expect(screen.getByTestId('table-rows').textContent).toBe('2');
    });

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/courses/course-1/activity?limit=50&offset=0',
    );
    expect(screen.getByText('ENROLLED')).toBeInTheDocument();
    expect(screen.getByText('GRADED')).toBeInTheDocument();
  });

  it('shows the loading state before the first page resolves', () => {
    // Never resolves, keeps the query in its initial loading state.
    (global.fetch as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {}));

    renderWithClient(<ActivityCard courseId="course-1" />);

    expect(screen.getByText('Loading activity, please wait...')).toBeInTheDocument();
  });

  it('loads the next page from the accumulated offset when Load More is clicked', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          activities: [activity('a1', 'FIRST'), activity('a2', 'SECOND')],
          totalCount: 3,
          hasMore: true,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          activities: [activity('a3', 'THIRD')],
          totalCount: 3,
          hasMore: false,
        }),
      );

    renderWithClient(<ActivityCard courseId="course-1" />);

    await waitFor(() => {
      expect(screen.getByText('FIRST')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Load More' }));

    await waitFor(() => {
      expect(screen.getByText('THIRD')).toBeInTheDocument();
    });

    // Second page requests offset = number of rows already loaded (2).
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/courses/course-1/activity?limit=50&offset=2',
    );
    // Rows accumulate across pages rather than replacing.
    expect(screen.getByTestId('table-rows').textContent).toBe('3');
  });
});
