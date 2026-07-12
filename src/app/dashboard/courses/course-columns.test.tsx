/** @vitest-environment jsdom */

import React from 'react';
import { render, screen } from '@testing-library/react';
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
vi.mock('@/components/dialogs/EditCourseDialog', () => ({ EditCourseDialog: () => null }));
vi.mock('@/components/dialogs/ConfirmDialog', () => ({ ConfirmDialog: () => null }));

type Row = { id: string; name: string; isArchived: boolean; enrolled: [] };
const courseRow: Row = { id: 'c1', name: 'Algorithms', isArchived: false, enrolled: [] };

const renderActionsCell = () => {
  const cols = columns(vi.fn(), vi.fn(), vi.fn(), 'UTC') as ColumnDef<Row>[];
  const actions = cols.find((c) => c.id === 'actions');
  const cell = (actions as { cell: (ctx: unknown) => React.ReactElement }).cell;
  return render(<>{cell({ row: { original: courseRow } })}</>);
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
    // Edit remains available to whoever manages the course.
    expect(screen.getByRole('button', { name: 'Edit Course' })).toBeInTheDocument();
  });

  it('hides the Duplicate Course action when there is no session', () => {
    useSessionMock.mockReturnValue({ data: null });
    renderActionsCell();

    expect(screen.queryByRole('button', { name: 'Duplicate Course' })).toBeNull();
  });
});

describe('course-columns display cells', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const renderCell = (key: string, course: Record<string, unknown>) => {
    const cols = columns(vi.fn(), vi.fn(), vi.fn(), 'UTC') as ColumnDef<Record<string, unknown>>[];
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
