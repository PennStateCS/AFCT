/** @vitest-environment jsdom */

import React from 'react';
import { render, renderHook, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import userEvent from '@testing-library/user-event';
import type { AccessorFnColumnDef } from '@tanstack/react-table';
import { MaxPointsCell, DueDateCell, useAssignmentColumns } from './assignment-columns';
import type { AssignmentWithProblemCount } from '@/types/course';

// Fresh QueryClient per test (retry off, no lingering cache) so each render starts
// with a cold assignment.shell cache entry.
const renderWithClient = (ui: React.ReactElement) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
};

describe('MaxPointsCell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  it('renders the row value without fetching when maxPoints is known', () => {
    renderWithClient(<MaxPointsCell courseId="c1" assignmentId="a1" maxPoints={42} />);

    expect(screen.getByText('42')).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('fetches the course assignment and renders the fetched value when maxPoints is null', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ maxPoints: 17 }),
    });

    renderWithClient(<MaxPointsCell courseId="c1" assignmentId="a1" maxPoints={null} />);

    // Loading placeholder before the query resolves.
    expect(screen.getByText('...')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('17')).toBeInTheDocument();
    });
    expect(global.fetch).toHaveBeenCalledWith('/api/courses/c1/assignments/a1?view=problems');
  });
});

describe('DueDateCell', () => {
  const base = {
    id: 'a1',
    courseId: 'c1',
    dueDate: new Date('2026-01-19T22:06:00.000Z'),
    allowLateSubmissions: false,
    lateCutoff: null,
  } as unknown as AssignmentWithProblemCount;

  it('shows only the base date when there are no overrides', () => {
    render(<DueDateCell assignment={base} timeZone="UTC" />);
    expect(screen.queryByRole('button', { name: /multiple due dates/i })).not.toBeInTheDocument();
  });

  it('shows a "Multiple" badge and lists each student in a popover', async () => {
    const user = userEvent.setup();
    const assignment = {
      ...base,
      overrides: [
        {
          studentName: 'Ada Lovelace',
          dueDate: new Date('2026-01-24T22:06:00.000Z'),
          allowLateSubmissions: null,
          lateCutoff: null,
        },
        // Same due date as everyone, but late is now allowed until a cutoff.
        {
          studentName: 'Alan Turing',
          dueDate: null,
          allowLateSubmissions: true,
          lateCutoff: new Date('2026-01-26T22:06:00.000Z'),
        },
      ],
    } as unknown as AssignmentWithProblemCount;

    render(<DueDateCell assignment={assignment} timeZone="UTC" />);

    const badge = screen.getByRole('button', { name: /multiple due dates \(2 overrides\)/i });
    expect(badge).toHaveTextContent('Multiple');

    await user.click(badge);

    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText('Alan Turing')).toBeInTheDocument();
    expect(screen.getByText('Everyone')).toBeInTheDocument();
    // The late-only override surfaces its late deadline.
    expect(screen.getByText(/late until/i)).toBeInTheDocument();
  });
});

describe('useAssignmentColumns — Type (individual/group) column', () => {
  const getTypeColumn = () => {
    const { result } = renderHook(() => useAssignmentColumns(false, vi.fn(), vi.fn(), 'UTC'));
    const col = result.current.find((c) => c.id === 'isGroup');
    if (!col) throw new Error('Type column not found');
    return col as AccessorFnColumnDef<AssignmentWithProblemCount, string>;
  };

  it('classifies rows as Group or Individual for sorting/filtering', () => {
    const col = getTypeColumn();
    expect(col.accessorFn({ isGroup: true } as AssignmentWithProblemCount, 0)).toBe('Group');
    expect(col.accessorFn({ isGroup: false } as AssignmentWithProblemCount, 0)).toBe('Individual');
  });

  it('exposes a multiselect filter labeled Type', () => {
    const col = getTypeColumn();
    expect(col.meta).toMatchObject({ filterVariant: 'multiselect', filterLabel: 'Type' });
  });
});
