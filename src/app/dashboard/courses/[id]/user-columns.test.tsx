/** @vitest-environment jsdom */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import type { User } from '@prisma/client';

vi.mock('@/lib/toast', () => import('@/test/mocks/toast').then((m) => m.toastModuleMock));

// The Manage menu is a Radix dropdown, which drives itself with pointer capture and portals
// that jsdom does not implement. Render its content inline so the items are queryable.
vi.mock('@/components/ui/dropdown-menu', () => {
  const Pass = ({ children }: { children: React.ReactNode }) => <>{children}</>;
  const Item = ({
    children,
    onClick,
    disabled,
    asChild,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    asChild?: boolean;
  }) =>
    asChild ? (
      <>{children}</>
    ) : (
      <button type="button" onClick={onClick} disabled={disabled}>
        {children}
      </button>
    );
  return {
    DropdownMenu: Pass,
    DropdownMenuPortal: Pass,
    DropdownMenuTrigger: Pass,
    DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    DropdownMenuGroup: Pass,
    DropdownMenuLabel: Pass,
    DropdownMenuItem: Item,
    DropdownMenuCheckboxItem: Item,
    DropdownMenuRadioGroup: Pass,
    DropdownMenuRadioItem: Item,
    DropdownMenuSeparator: () => null,
    DropdownMenuShortcut: Pass,
    DropdownMenuSub: Pass,
    DropdownMenuSubTrigger: Pass,
    DropdownMenuSubContent: Pass,
  };
});

import { userColumns } from './user-columns';

type RosterRow = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  enrollmentStatus?: string;
  hasSubmissions?: boolean;
};

const student: RosterRow = {
  id: 'u1',
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@x.edu',
  role: 'STUDENT',
  enrollmentStatus: 'ENROLLED',
  hasSubmissions: false,
};

/**
 * Render just the Manage cell for one row, under a given viewer.
 *
 * The permission matrix in `ActionsCell` decides who may change a role, drop a student,
 * reset a password and remove someone. It is the most consequential logic on the roster
 * and had no test before the roster moved to server-side pagination.
 */
function renderManageCell(
  row: RosterRow,
  opts: {
    courseIsArchived?: boolean;
    viewerRole?: string | null;
    viewerIsAdmin?: boolean;
  } = {},
) {
  const columns = userColumns(
    vi.fn(),
    'c1',
    opts.courseIsArchived ?? false,
    opts.viewerRole ?? 'FACULTY',
    opts.viewerIsAdmin ?? false,
  ) as ColumnDef<User>[];

  const manage = columns.find((c) => c.id === 'manage');
  if (!manage) throw new Error('No manage column for this viewer');

  const Cell = manage.cell as (ctx: unknown) => React.ReactElement;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      {Cell({ row: { original: row } })}
    </QueryClientProvider>,
  );
}

const manageButton = () => screen.getByRole('button', { name: /^Manage / });
const item = (name: RegExp) => screen.getByRole('button', { name });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('roster Manage menu', () => {
  it('gives no Manage column to a viewer with no course role', () => {
    const columns = userColumns(vi.fn(), 'c1', false, null, false);

    expect(columns.find((c) => c.id === 'manage')).toBeUndefined();
  });

  it('lets faculty remove a student who has no work', () => {
    renderManageCell(student);

    expect(item(/Remove From Course/i)).not.toBeDisabled();
  });

  it('refuses to remove a student who has submissions', () => {
    renderManageCell({ ...student, hasSubmissions: true });

    // Removal is destructive and their work hangs off the roster row; dropping is the
    // route that keeps it. This is the flag the paginated query resolves per page.
    expect(item(/Remove From Course/i)).toBeDisabled();
  });

  it('refuses to remove anyone from an archived course', () => {
    renderManageCell(student, { courseIsArchived: true });

    expect(item(/Remove From Course/i)).toBeDisabled();
  });

  it('offers Drop to faculty', () => {
    renderManageCell(student);

    expect(item(/Drop From Course/i)).toBeInTheDocument();
  });

  it('offers Re-enroll instead of Drop for a dropped student', () => {
    renderManageCell({ ...student, enrollmentStatus: 'DROPPED' });

    expect(item(/Re-?enroll/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Drop From Course/i })).not.toBeInTheDocument();
  });

  it('does not let a TA drop a student', () => {
    renderManageCell(student, { viewerRole: 'TA' });

    // Dropping is faculty/admin only, matching the status endpoint's own gate.
    expect(screen.queryByRole('button', { name: /Drop From Course/i })).not.toBeInTheDocument();
  });

  it('disables Manage entirely for a faculty row unless the viewer is an admin', () => {
    renderManageCell({ ...student, role: 'FACULTY' });

    expect(manageButton()).toBeDisabled();
  });

  it('lets an admin manage a faculty row', () => {
    renderManageCell({ ...student, role: 'FACULTY' }, { viewerIsAdmin: true });

    expect(manageButton()).not.toBeDisabled();
  });

  it('offers a password reset for a student', () => {
    renderManageCell(student);

    expect(item(/Reset Password/i)).toBeInTheDocument();
  });

  it('offers no password reset for staff', () => {
    renderManageCell({ ...student, role: 'TA' }, { viewerIsAdmin: true });

    // Course staff resets are a site-admin job on the User Accounts page, not a course one.
    expect(screen.queryByRole('button', { name: /Reset Password/i })).not.toBeInTheDocument();
  });
});
