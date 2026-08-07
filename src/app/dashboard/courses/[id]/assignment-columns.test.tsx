/** @vitest-environment jsdom */

import React from 'react';
import { render, renderHook, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import userEvent from '@testing-library/user-event';
import type { AccessorFnColumnDef } from '@tanstack/react-table';
import {
  MaxPointsCell,
  DueDateCell,
  OverrideAwareCell,
  useAssignmentColumns,
} from './assignment-columns';
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

describe('OverrideAwareCell', () => {
  const base = {
    id: 'a1',
    courseId: 'c1',
    unlockAt: new Date('2026-01-10T00:00:00.000Z'),
    allowLateSubmissions: false,
    lateCutoff: null,
  } as unknown as AssignmentWithProblemCount;

  it('shows the base value (no badge) when overrides do not change the field', () => {
    // The override only moves the due date; the unlock date is the same for everyone.
    const assignment = {
      ...base,
      overrides: [{ studentName: 'Ada Lovelace', unlockAt: null, dueDate: new Date() }],
    } as unknown as AssignmentWithProblemCount;

    render(
      <OverrideAwareCell
        assignment={assignment}
        timeZone="UTC"
        field="unlockAt"
        label="Available From"
      />,
    );
    expect(screen.queryByRole('button', { name: /multiple/i })).not.toBeInTheDocument();
  });

  it('shows a "Multiple" badge and per-student values when the field varies', async () => {
    const user = userEvent.setup();
    const assignment = {
      ...base,
      overrides: [
        { studentName: 'Ada Lovelace', unlockAt: new Date('2026-01-15T00:00:00.000Z') },
      ],
    } as unknown as AssignmentWithProblemCount;

    render(
      <OverrideAwareCell
        assignment={assignment}
        timeZone="UTC"
        field="unlockAt"
        label="Available From"
      />,
    );

    const badge = screen.getByRole('button', { name: /multiple available from values/i });
    await user.click(badge);
    expect(await screen.findByText('Everyone')).toBeInTheDocument();
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
  });

  it('renders Yes/No for the allow-late field', () => {
    render(
      <OverrideAwareCell assignment={base} timeZone="UTC" field="allowLateSubmissions" label="Allow Late" />,
    );
    expect(screen.getByText('No')).toBeInTheDocument();
  });
});

describe('useAssignmentColumns — Title cell', () => {
  const titleCell = (original: Record<string, unknown>) => {
    const { result } = renderHook(() => useAssignmentColumns(false, vi.fn(), vi.fn(), 'UTC'));
    const col = result.current.find((c) => (c as { accessorKey?: string }).accessorKey === 'title');
    if (!col?.cell || typeof col.cell !== 'function') throw new Error('title cell not found');
    return (col.cell as (ctx: { row: { original: Record<string, unknown> } }) => React.ReactNode)({
      row: { original },
    });
  };

  it('links the title and opens a description modal when a description exists', async () => {
    const user = userEvent.setup();
    render(<>{titleCell({ id: 'a1', courseId: 'c1', title: 'HW 1', description: 'Do the thing' })}</>);

    expect(screen.getByRole('link', { name: 'HW 1' })).toHaveAttribute(
      'href',
      '/dashboard/courses/c1/a1',
    );
    await user.click(screen.getByText('View description'));
    expect(await screen.findByText('Do the thing')).toBeInTheDocument();
  });

  it('omits the description link when there is no description', () => {
    render(<>{titleCell({ id: 'a1', courseId: 'c1', title: 'HW 1', description: null })}</>);
    expect(screen.queryByText('View description')).not.toBeInTheDocument();
  });
});

describe('useAssignmentColumns — Manage menu', () => {
  it('offers deep links to the assignment tabs', async () => {
    const user = userEvent.setup();
    const { result } = renderHook(() => useAssignmentColumns(false, vi.fn(), vi.fn(), 'UTC'));
    const actions = result.current.find((c) => c.id === 'actions');
    if (!actions?.cell || typeof actions.cell !== 'function') throw new Error('actions cell not found');

    const row = { original: { id: 'a1', courseId: 'c1', title: 'HW 1' } };
    render(<>{(actions.cell as (ctx: unknown) => React.ReactNode)({ row })}</>);

    await user.click(screen.getByRole('button', { name: /manage assignment hw 1/i }));

    const base = '/dashboard/courses/c1/a1';
    expect(screen.getByRole('menuitem', { name: /view assignment/i })).toHaveAttribute('href', base);
    expect(screen.getByRole('menuitem', { name: /submissions/i })).toHaveAttribute(
      'href',
      `${base}?tab=submissions`,
    );
    expect(screen.getByRole('menuitem', { name: /statistics/i })).toHaveAttribute(
      'href',
      `${base}?tab=statistics`,
    );
    expect(screen.getByRole('menuitem', { name: /similarity/i })).toHaveAttribute(
      'href',
      `${base}?tab=similarity`,
    );
  });

  it('offers Duplicate Assignment and calls onDuplicate with the row', async () => {
    const user = userEvent.setup();
    const onDuplicate = vi.fn();
    const { result } = renderHook(() =>
      useAssignmentColumns(false, vi.fn(), vi.fn(), 'UTC', onDuplicate),
    );
    const actions = result.current.find((c) => c.id === 'actions');
    if (!actions?.cell || typeof actions.cell !== 'function') throw new Error('actions cell not found');

    const row = {
      original: { id: 'a1', courseId: 'c1', title: 'HW 1', isGroup: false, problemCount: 2 },
    };
    render(<>{(actions.cell as (ctx: unknown) => React.ReactNode)({ row })}</>);

    await user.click(screen.getByRole('button', { name: /manage assignment hw 1/i }));
    await user.click(screen.getByRole('menuitem', { name: /duplicate assignment/i }));
    expect(onDuplicate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'a1', title: 'HW 1', isGroup: false, problemCount: 2 }),
    );
  });

  it('hides Duplicate Assignment when no onDuplicate is provided', async () => {
    const user = userEvent.setup();
    const { result } = renderHook(() => useAssignmentColumns(false, vi.fn(), vi.fn(), 'UTC'));
    const actions = result.current.find((c) => c.id === 'actions');
    if (!actions?.cell || typeof actions.cell !== 'function') throw new Error('actions cell not found');
    render(
      <>
        {(actions.cell as (ctx: unknown) => React.ReactNode)({
          row: { original: { id: 'a1', courseId: 'c1', title: 'HW 1' } },
        })}
      </>,
    );
    await user.click(screen.getByRole('button', { name: /manage assignment hw 1/i }));
    expect(screen.queryByRole('menuitem', { name: /duplicate assignment/i })).not.toBeInTheDocument();
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
