/** @vitest-environment jsdom */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import type { ColumnDef } from '@tanstack/react-table';

// Source uses the automatic JSX runtime; expose React for the classic-runtime cells.
const globalWithReact = globalThis as typeof globalThis & { React?: typeof React };
globalWithReact.React = React;

// Render dropdown primitives inline so the trigger button is directly queryable.
vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuLabel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// The action dialogs are heavy and irrelevant here.
vi.mock('@/components/dialogs/EditUserDialog', () => ({ EditUserDialog: () => null }));
vi.mock('@/components/dialogs/ResetPasswordDialog', () => ({
  ResetPasswordDialog: () => null,
}));
vi.mock('@/components/dialogs/ConfirmDialog', () => ({ ConfirmDialog: () => null }));

import { getUserColumns } from './user-columns';

const renderCell = (key: string, user: Record<string, unknown>) => {
  const cols = getUserColumns(vi.fn(), 'UTC') as ColumnDef<Record<string, unknown>>[];
  const col = cols.find(
    (c) =>
      ('accessorKey' in c && c.accessorKey === key) ||
      ('id' in c && (c as { id?: string }).id === key),
  ) as { cell: (ctx: unknown) => React.ReactElement };
  const row = { original: user, getValue: (k: string) => user[k] };
  return render(<>{col.cell({ row })}</>);
};

const baseUser = {
  id: 'u1',
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@example.com',
  avatar: null,
  isAdmin: false,
  inactive: false,
  temporaryPassword: false,
  createdAt: new Date('2026-01-01T00:00:00Z'),
};

describe('user-columns display cells', () => {
  it('names the per-row Manage trigger for the specific user', () => {
    renderCell('actions', baseUser);
    expect(
      screen.getByRole('button', { name: 'Manage user Ada Lovelace' }),
    ).toBeInTheDocument();
  });

  it('renders the email as a mailto link', () => {
    renderCell('email', baseUser);
    const link = screen.getByRole('link', { name: 'ada@example.com' });
    expect(link).toHaveAttribute('href', 'mailto:ada@example.com');
  });

  it('shows an Admin badge only for admins', () => {
    renderCell('isAdmin', { ...baseUser, isAdmin: true });
    expect(screen.getByText('Admin')).toBeInTheDocument();
  });

  it('shows Active vs Inactive status', () => {
    renderCell('inactive', { ...baseUser, inactive: false });
    expect(screen.getByText('Active')).toBeInTheDocument();

    renderCell('inactive', { ...baseUser, inactive: true });
    expect(screen.getByText('Inactive')).toBeInTheDocument();
  });

  it('flags a temporary password', () => {
    renderCell('temporaryPassword', { ...baseUser, temporaryPassword: true });
    expect(screen.getByText('Temporary')).toBeInTheDocument();

    renderCell('temporaryPassword', { ...baseUser, temporaryPassword: false });
    expect(screen.getByText('Normal')).toBeInTheDocument();
  });

  it('falls back to initials when the user has no avatar image', () => {
    renderCell('avatar', baseUser);
    expect(screen.getByText('AL')).toBeInTheDocument();
  });

  it('shows a Locked badge only when lockedUntil is in the future', () => {
    renderCell('inactive', {
      ...baseUser,
      inactive: false,
      lockedUntil: new Date(Date.now() + 10 * 60_000),
    });
    expect(screen.getByText(/^Locked/)).toBeInTheDocument();
  });

  it('does not show a Locked badge for an expired or absent lock', () => {
    renderCell('inactive', { ...baseUser, inactive: false, lockedUntil: new Date(Date.now() - 1000) });
    expect(screen.queryByText(/^Locked/)).not.toBeInTheDocument();

    renderCell('inactive', { ...baseUser, inactive: false, lockedUntil: null });
    expect(screen.queryByText(/^Locked/)).not.toBeInTheDocument();
  });

  it('classifies rows for the lock-status filter by current lock state', () => {
    const cols = getUserColumns(vi.fn(), 'UTC') as ColumnDef<Record<string, unknown>>[];
    const lockCol = cols.find(
      (c) => 'id' in c && (c as { id?: string }).id === 'lockStatus',
    ) as unknown as { accessorFn: (row: Record<string, unknown>) => string };
    expect(lockCol.accessorFn({ lockedUntil: new Date(Date.now() + 60_000) })).toBe('locked');
    expect(lockCol.accessorFn({ lockedUntil: new Date(Date.now() - 60_000) })).toBe('unlocked');
    expect(lockCol.accessorFn({ lockedUntil: null })).toBe('unlocked');
  });
});
