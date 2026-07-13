/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ColumnDef } from '@tanstack/react-table';
import { columns } from './course-columns';

// The source uses the automatic JSX runtime; expose React globally so the
// column cell's classic-runtime JSX resolves under the test transform.
const globalWithReact = globalThis as typeof globalThis & { React?: typeof React };
globalWithReact.React = React;

// Duplicating is admin-only; vary the session per test.
const useSessionMock = vi.hoisted(() => vi.fn());
vi.mock('next-auth/react', () => ({ useSession: useSessionMock }));

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

// Render dropdown primitives inline so every menu item is queryable without
// opening the Radix portal.
vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuLabel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuItem: ({
    children,
    onClick,
    asChild,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    asChild?: boolean;
  }) =>
    asChild ? (
      <div>{children}</div>
    ) : (
      <button type="button" onClick={onClick}>
        {children}
      </button>
    ),
}));

// Stub the heavy dialogs; the duplicate stub only reports whether it's open.
vi.mock('@/components/dialogs/DuplicateCourseDialog', () => ({
  default: ({ open }: { open: boolean }) => (open ? <div>duplicate-dialog-open</div> : null),
}));
// When open, expose the confirm action as a button labelled with its confirmText
// so tests can drive the confirm flow.
vi.mock('@/components/dialogs/ConfirmDialog', () => ({
  ConfirmDialog: ({
    open,
    onConfirm,
    confirmText,
  }: {
    open: boolean;
    onConfirm: () => void;
    confirmText?: string;
  }) =>
    open ? (
      <button type="button" onClick={onConfirm}>
        {confirmText}
      </button>
    ) : null,
}));

type Row = { id: string; name: string; isArchived: boolean; enrolled: [] };
const courseRow: Row = { id: 'c1', name: 'Algorithms', isArchived: false, enrolled: [] };

const renderActionsCell = (row: Row = courseRow) => {
  const cols = columns(vi.fn(), vi.fn(), 'UTC') as ColumnDef<Row>[];
  const actions = cols.find((c) => c.id === 'actions');
  const cell = (actions as { cell: (ctx: unknown) => React.ReactElement }).cell;
  return render(<>{cell({ row: { original: row } })}</>);
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('course actions — Duplicate Course', () => {
  it('shows the Duplicate Course action for a system admin and opens the dialog', async () => {
    useSessionMock.mockReturnValue({ data: { user: { isAdmin: true } } });
    const user = userEvent.setup();
    renderActionsCell();

    const dup = screen.getByRole('button', { name: 'Duplicate Course' });
    expect(dup).toBeInTheDocument();
    expect(screen.queryByText('duplicate-dialog-open')).toBeNull();

    await user.click(dup);
    expect(screen.getByText('duplicate-dialog-open')).toBeInTheDocument();
  });

  it('hides the Duplicate Course action from a non-admin', () => {
    useSessionMock.mockReturnValue({ data: { user: { isAdmin: false } } });
    renderActionsCell();

    expect(screen.queryByRole('button', { name: 'Duplicate Course' })).toBeNull();
    // View Course stays available to whoever manages the course.
    expect(screen.getByRole('link', { name: 'View Course' })).toBeInTheDocument();
  });

  it('hides the Duplicate Course action when there is no session', () => {
    useSessionMock.mockReturnValue({ data: null });
    renderActionsCell();

    expect(screen.queryByRole('button', { name: 'Duplicate Course' })).toBeNull();
  });
});

describe('course actions — Edit Course', () => {
  it('never offers Edit Course (editing lives on the course Settings tab)', () => {
    useSessionMock.mockReturnValue({ data: { user: { isAdmin: true } } });
    renderActionsCell({ ...courseRow, isArchived: false });

    expect(screen.queryByRole('button', { name: 'Edit Course' })).toBeNull();
  });
});

const renderActionsCellDirect = (row: Row, onDeleted: () => void) => {
  const cols = columns(onDeleted, vi.fn(), 'UTC') as ColumnDef<Row>[];
  const cell = (
    cols.find((c) => c.id === 'actions') as { cell: (ctx: unknown) => React.ReactElement }
  ).cell;
  return render(<>{cell({ row: { original: row } })}</>);
};

describe('course actions — Archive / Restore (admin-only)', () => {
  beforeEach(() => {
    useSessionMock.mockReturnValue({ data: { user: { isAdmin: true } } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
  });

  it('archives an active course after confirmation', async () => {
    const onDeleted = vi.fn();
    renderActionsCellDirect({ ...courseRow, isArchived: false }, onDeleted);

    const user = userEvent.setup();
    expect(screen.queryByRole('button', { name: 'Restore Course' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Archive Course' }));
    await user.click(screen.getByRole('button', { name: 'Archive' }));

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/courses/c1/archive',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ isArchived: true }),
      }),
    );
    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
  });

  it('restores an archived course after confirmation', async () => {
    const onDeleted = vi.fn();
    renderActionsCellDirect({ ...courseRow, isArchived: true }, onDeleted);

    const user = userEvent.setup();
    expect(screen.queryByRole('button', { name: 'Archive Course' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Restore Course' }));
    await user.click(screen.getByRole('button', { name: 'Restore' }));

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/courses/c1/archive',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ isArchived: false }),
      }),
    );
    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
  });

  it('hides Archive/Restore from non-admins', () => {
    useSessionMock.mockReturnValue({ data: { user: { isAdmin: false } } });
    renderActionsCell({ ...courseRow, isArchived: false });
    expect(screen.queryByRole('button', { name: 'Archive Course' })).toBeNull();

    renderActionsCell({ ...courseRow, isArchived: true });
    expect(screen.queryByRole('button', { name: 'Restore Course' })).toBeNull();
  });
});

describe('course actions — Delete Course (admin-only, active courses)', () => {
  beforeEach(() => {
    useSessionMock.mockReturnValue({ data: { user: { isAdmin: true } } });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ deleted: 'hard' }) }),
    );
  });

  it('deletes an active course after confirmation', async () => {
    const onDeleted = vi.fn();
    renderActionsCellDirect({ ...courseRow, isArchived: false }, onDeleted);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Delete Course' }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    expect(global.fetch).toHaveBeenCalledWith('/api/courses/c1', { method: 'DELETE' });
    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
  });

  it('hides Delete Course from non-admins', () => {
    useSessionMock.mockReturnValue({ data: { user: { isAdmin: false } } });
    renderActionsCell({ ...courseRow, isArchived: false });
    expect(screen.queryByRole('button', { name: 'Delete Course' })).toBeNull();
  });

  it('hides Delete Course on an archived course (restore it first)', () => {
    renderActionsCell({ ...courseRow, isArchived: true });
    expect(screen.queryByRole('button', { name: 'Delete Course' })).toBeNull();
  });
});

describe('course-columns display cells', () => {
  const renderCell = (key: string, course: Record<string, unknown>) => {
    const cols = columns(vi.fn(), vi.fn(), 'UTC') as ColumnDef<Record<string, unknown>>[];
    const col = cols.find(
      (c) =>
        ('accessorKey' in c && c.accessorKey === key) ||
        ('id' in c && (c as { id?: string }).id === key),
    ) as { cell: (ctx: unknown) => React.ReactElement };
    const row = { original: course, getValue: (k: string) => course[k] };
    return render(<>{col.cell({ row })}</>);
  };

  it('exposes the full course name to AT even when the visible text is truncated', () => {
    const fullName = 'Introduction to Very Long Course Names That Exceed The Visible Limit';
    renderCell('name', { id: 'c1', name: fullName });

    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/dashboard/courses/c1');
    expect(link).toHaveAttribute('aria-label', fullName);
    expect(link).toHaveAttribute('title', fullName);
    expect(link.textContent?.endsWith('...')).toBe(true);
  });

  it('formats a 6-character registration code as XXX-XXX, uppercased', () => {
    renderCell('regCode', { regCode: 'abc123' });
    expect(screen.getByText('ABC-123')).toBeInTheDocument();
  });

  it('centers the registration badge and labels an open window', () => {
    const now = Date.now();
    renderCell('registrationStatus', {
      registrationOpenAt: new Date(now - 1000).toISOString(),
      registrationCloseAt: new Date(now + 1_000_000).toISOString(),
    });
    expect(screen.getByText('Open').parentElement).toHaveClass('justify-center');
  });

  it('marks registration Closed once the window has passed', () => {
    const now = Date.now();
    renderCell('registrationStatus', {
      registrationOpenAt: new Date(now - 2_000_000).toISOString(),
      registrationCloseAt: new Date(now - 1_000_000).toISOString(),
    });
    expect(screen.getByText('Closed')).toBeInTheDocument();
  });

  it('lists faculty names, and shows None when there are none', () => {
    renderCell('instructor', {
      enrolled: [{ firstName: 'Ada', lastName: 'Lovelace', courseRole: 'FACULTY' }],
    });
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();

    renderCell('instructor', { enrolled: [] });
    expect(screen.getByText('None')).toBeInTheDocument();
  });
});
