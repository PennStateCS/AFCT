/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ArchivedCoursesClient from './ArchivedCoursesClient';
import type { CourseListItem } from '@/lib/courses-list';

const renderWithClient = (ui: React.ReactElement) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
};

// Return a marker actions column so we can assert whether it survives filtering.
const columnsMock = vi.hoisted(() => vi.fn(() => [{ id: 'name' }, { id: 'actions' }]));
vi.mock('../courses/course-columns', () => ({ columns: columnsMock }));

vi.mock('@/hooks/use-effective-timezone', () => ({
  useEffectiveTimezone: () => ({ timezone: 'UTC' }),
}));

vi.mock('@/components/ui/data-table', () => ({
  DataTable: ({ data, columns }: { data: CourseListItem[]; columns: { id?: string }[] }) => (
    <div>
      <div data-testid="table-rows">{data.length}</div>
      <div data-testid="column-ids">{columns.map((c) => c.id).join(',')}</div>
      <ul>
        {data.map((c) => (
          <li key={c.id}>{c.name}</li>
        ))}
      </ul>
    </div>
  ),
}));

const course = (id: string, name: string, isArchived: boolean): CourseListItem =>
  ({ id, name, isArchived, enrolled: [] }) as unknown as CourseListItem;

describe('ArchivedCoursesClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  it('renders the archived courses heading and server-provided rows without a fetch', () => {
    renderWithClient(
      <ArchivedCoursesClient initialCourses={[course('c1', 'Old Algorithms', true)]} isAdmin />,
    );

    expect(screen.getByRole('heading', { name: 'Archived Courses' })).toBeInTheDocument();
    expect(screen.getByTestId('table-rows').textContent).toBe('1');
    expect(screen.getByText('Old Algorithms')).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('keeps the Manage (actions) column for admins', () => {
    renderWithClient(
      <ArchivedCoursesClient initialCourses={[course('c1', 'Old Algorithms', true)]} isAdmin />,
    );
    expect(screen.getByTestId('column-ids').textContent).toContain('actions');
  });

  it('drops the Manage (actions) column for non-admins', () => {
    renderWithClient(
      <ArchivedCoursesClient
        initialCourses={[course('c1', 'Old Algorithms', true)]}
        isAdmin={false}
      />,
    );
    const ids = screen.getByTestId('column-ids').textContent ?? '';
    expect(ids).toContain('name');
    expect(ids).not.toContain('actions');
  });

  it('drops active courses when refreshing from the shared list endpoint', async () => {
    // The endpoint returns the full list; the client must keep only archived ones.
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => [
        course('c1', 'Archived One', true),
        course('c2', 'Still Active', false),
      ],
    });

    // A row action's onDeleted callback triggers the refetch; grab it from columns().
    // columns(onCourseDeleted, onCourseDuplicated, timeZone) — deleted is arg 0.
    renderWithClient(
      <ArchivedCoursesClient initialCourses={[course('c1', 'Archived One', true)]} isAdmin />,
    );
    const onDeleted = (columnsMock.mock.calls.at(-1) as unknown as unknown[])[0] as () => void;
    onDeleted();

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/me/courses', { cache: 'no-store' });
      expect(screen.getByText('Archived One')).toBeInTheDocument();
    });
    // The active course from the response is filtered out.
    expect(screen.queryByText('Still Active')).not.toBeInTheDocument();
    expect(screen.getByTestId('table-rows').textContent).toBe('1');
  });
});
