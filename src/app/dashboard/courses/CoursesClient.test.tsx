/** @vitest-environment jsdom */

import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CoursesClient from './CoursesClient';
import type { CourseListItem } from '@/lib/courses-list';

// Render with a fresh QueryClient per test (retry off, no lingering cache) so the
// courses query starts clean each time.
const renderWithClient = (ui: React.ReactElement) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
};

// Captures the (onCourseUpdated, onCourseDeleted, timezone) args the client passes.
const columnsMock = vi.hoisted(() => vi.fn(() => []));

vi.mock('./course-columns', () => ({ columns: columnsMock }));

vi.mock('@/hooks/use-effective-timezone', () => ({
  useEffectiveTimezone: () => ({ timezone: 'UTC' }),
}));

vi.mock('@/components/ui/data-table', () => ({
  DataTable: ({ data, loading }: { data: CourseListItem[]; loading?: boolean }) => (
    <div>
      <div data-testid="table-loading">{String(!!loading)}</div>
      <div data-testid="table-rows">{data.length}</div>
      <ul>
        {data.map((c) => (
          <li key={c.id}>{c.name}</li>
        ))}
      </ul>
    </div>
  ),
}));

vi.mock('@/components/dialogs/CreateCourseDialog', () => ({
  CreateCourseDialog: ({ onSuccess }: { onSuccess: () => void }) => (
    <button type="button" onClick={onSuccess}>
      Trigger Refresh
    </button>
  ),
}));

const course = (id: string, name: string): CourseListItem =>
  ({ id, name, enrolled: [] }) as unknown as CourseListItem;

describe('CoursesClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  it('renders server-provided courses without an initial fetch', () => {
    renderWithClient(<CoursesClient initialCourses={[course('c1', 'Algorithms')]} />);

    expect(screen.getByTestId('table-rows').textContent).toBe('1');
    expect(screen.getByText('Algorithms')).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('refreshes the list from /api/courses/list on demand', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => [course('c1', 'Refreshed'), course('c2', 'Second')],
    });

    renderWithClient(<CoursesClient initialCourses={[course('c1', 'Original')]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Trigger Refresh' }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/courses/list', { cache: 'no-store' });
      expect(screen.getByText('Refreshed')).toBeInTheDocument();
      expect(screen.getByText('Second')).toBeInTheDocument();
    });
  });

  it('shows an error banner when a refresh fails, then recovers on retry', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({}) }).mockResolvedValueOnce({
      ok: true,
      json: async () => [course('c1', 'Recovered')],
    });

    renderWithClient(<CoursesClient initialCourses={[course('c1', 'Original')]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Trigger Refresh' }));

    await waitFor(() => {
      expect(screen.getByText('Failed to refresh courses. Please try again.')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => {
      expect(
        screen.queryByText('Failed to refresh courses. Please try again.'),
      ).not.toBeInTheDocument();
      expect(screen.getByText('Recovered')).toBeInTheDocument();
    });
  });

  it('optimistically merges a single-row update into the cached list', async () => {
    renderWithClient(<CoursesClient initialCourses={[course('c1', 'Before')]} />);

    // The client passes an onCourseUpdated callback into columns(); invoking it
    // should patch that row in the cache and re-render the table.
    const onCourseUpdated = columnsMock.mock.calls.at(-1)?.[0] as (c: CourseListItem) => void;
    await act(async () => {
      onCourseUpdated(course('c1', 'After'));
    });

    await waitFor(() => {
      expect(screen.getByText('After')).toBeInTheDocument();
      expect(screen.queryByText('Before')).not.toBeInTheDocument();
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
