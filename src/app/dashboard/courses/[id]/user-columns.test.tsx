/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import type { User } from '@prisma/client';

vi.mock('@/lib/toast', () => import('@/test/mocks/toast').then((m) => m.toastModuleMock));
import { toastMock } from '@/test/mocks/toast';

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

// ConfirmDialog is a Radix alert dialog behind a portal. Render it as a plain button when
// open so the confirm handler (which performs the roster mutation) can be driven directly.
vi.mock('@/components/dialogs/ConfirmDialog', () => ({
  ConfirmDialog: ({
    open,
    onConfirm,
    confirmText,
  }: {
    open: boolean;
    onConfirm: () => void | Promise<void>;
    confirmText?: string;
  }) => (open ? <button type="button" onClick={() => void onConfirm()}>{confirmText}</button> : null),
}));

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

/** Render one non-Manage column's cell for a row, to check what it reads off the row. */
function renderCell(columnId: string, row: Record<string, unknown>) {
  const columns = userColumns(vi.fn(), 'c1', false, 'FACULTY', false) as ColumnDef<User>[];
  const target = columns.find(
    (c) => c.id === columnId || (c as { accessorKey?: string }).accessorKey === columnId,
  );
  if (!target) throw new Error(`No ${columnId} column`);
  const Cell = target.cell as (ctx: unknown) => React.ReactElement;
  return render(<>{Cell({ row: { original: row } })}</>);
}

beforeEach(() => {
  vi.clearAllMocks();
});

/*
 * The columns are fed straight from GET /api/courses/[id]/roster, so this block pins the
 * field names they read off a row. A server row that spelled the course role `courseRole`
 * rendered an empty Role badge and a dash in every Status cell, and no test caught it
 * because RosterCard's own tests use stub columns.
 */
describe('roster columns against a server row', () => {
  const serverRow = {
    rosterId: 'r1',
    id: 'u1',
    firstName: 'Ada',
    lastName: 'Lovelace',
    email: 'ada@x.edu',
    avatar: null,
    cropX: null,
    cropY: null,
    zoom: null,
    role: 'STUDENT',
    enrollmentStatus: 'ENROLLED',
    hasSubmissions: false,
  };

  it('names the role in the Role badge', () => {
    renderCell('role', serverRow);

    expect(screen.getByText('Student')).toBeInTheDocument();
  });

  it('shows the role for staff too', () => {
    renderCell('role', { ...serverRow, role: 'FACULTY' });

    expect(screen.getByText('Faculty')).toBeInTheDocument();
  });

  it('reads a student standing in the Status cell', () => {
    renderCell('enrollmentStatus', serverRow);

    expect(screen.getByText('Enrolled')).toBeInTheDocument();
  });

  it('badges a dropped student', () => {
    renderCell('enrollmentStatus', { ...serverRow, enrollmentStatus: 'DROPPED' });

    expect(screen.getByText('Dropped')).toBeInTheDocument();
  });

  it('leaves Status blank for staff, who have no enrollment standing', () => {
    renderCell('enrollmentStatus', { ...serverRow, role: 'TA' });

    expect(screen.getByText('—')).toBeInTheDocument();
  });
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

/**
 * The roster mutations. Everything above proves who is *offered* an action; this proves what
 * the action then does. These are the writes that change a student's access to a course, so
 * both the success path and the server-refusal path are pinned.
 */
describe('roster mutations', () => {
  const okJson = (body: unknown = {}) =>
    ({ ok: true, status: 200, json: async () => body }) as Response;
  const errJson = (status: number, body: unknown) =>
    ({ ok: false, status, json: async () => body }) as Response;

  let fetchMock: ReturnType<typeof vi.fn>;
  const originalFetch = global.fetch;

  beforeEach(() => {
    fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  /** Open the Manage menu, click an item, then confirm the dialog it opens. */
  async function act(row: RosterRow, itemName: RegExp, confirmName: RegExp) {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const columns = userColumns(onChange, 'c1', false, 'FACULTY', false) as ColumnDef<User>[];
    const manage = columns.find((c) => c.id === 'manage');
    if (!manage) throw new Error('No manage column');
    const Cell = manage.cell as (ctx: unknown) => React.ReactElement;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    render(
      <QueryClientProvider client={client}>{Cell({ row: { original: row } })}</QueryClientProvider>,
    );
    await user.click(screen.getByRole('button', { name: itemName }));
    await user.click(await screen.findByRole('button', { name: confirmName }));
    return { onChange };
  }

  it('drops a student through the roster status endpoint', async () => {
    fetchMock.mockResolvedValue(okJson());

    const { onChange } = await act(student, /^Drop/, /^Drop student$/);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/courses/c1/roster/u1/status');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ status: 'DROPPED' });
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(toastMock.success).toHaveBeenCalledWith('Student dropped from course');
  });

  it('re-enrolls a dropped student', async () => {
    // Re-enrolling is not destructive, so it fires straight from the menu with no confirm.
    fetchMock.mockResolvedValue(okJson());
    const user = userEvent.setup();
    renderManageCell({ ...student, enrollmentStatus: 'DROPPED' });
    await user.click(screen.getByRole('button', { name: /^Re-enroll/ }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ status: 'ENROLLED' });
    expect(toastMock.success).toHaveBeenCalledWith('Student re-enrolled');
  });

  it('surfaces the server reason when a drop is refused, and does not claim success', async () => {
    fetchMock.mockResolvedValue(errJson(409, { error: 'Course is archived' }));

    const { onChange } = await act(student, /^Drop/, /^Drop student$/);

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('Course is archived'));
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('removes a student from the roster', async () => {
    fetchMock.mockResolvedValue(okJson());

    const { onChange } = await act(student, /^Remove/, /^Remove from course$/);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/courses/c1/roster/u1');
    expect(init.method).toBe('DELETE');
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(toastMock.success).toHaveBeenCalledWith('User removed from roster');
  });

  it('reports the server message when a removal is refused', async () => {
    fetchMock.mockResolvedValue(errJson(409, { error: 'Student has submissions' }));

    const { onChange } = await act(student, /^Remove/, /^Remove from course$/);

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('Student has submissions'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('reports a network failure rather than failing silently', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));

    const { onChange } = await act(student, /^Remove/, /^Remove from course$/);

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith(expect.stringContaining('offline')),
    );
    expect(onChange).not.toHaveBeenCalled();
  });

  it('never fires a removal request for a student who has work', async () => {
    // The item is disabled, so no confirm opens and nothing reaches the server. The server
    // refuses this too; the point here is that the UI does not ask.
    const user = userEvent.setup();
    renderManageCell({ ...student, hasSubmissions: true });

    const remove = screen.getByRole('button', { name: /^Remove From Course/ });
    expect(remove).toBeDisabled();
    await user.click(remove);

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('roster display cells', () => {
  it('falls back to initials when the student has no avatar', () => {
    const { container } = renderCell('avatar', student);

    expect(container.textContent).toContain('AL');
  });

  it('shows a neutral placeholder when the row has no name at all', () => {
    // getInitials returns 'U' for a nameless row; its email fallback is unreachable
    // because of that earlier return, so do not assert on the email here.
    const { container } = renderCell('avatar', { ...student, firstName: '', lastName: '' });

    expect(container.textContent).toContain('U');
  });

  it('makes the email a mailto link, so staff can contact a student from the roster', () => {
    renderCell('email', student);

    const link = screen.getByRole('link', { name: 'ada@x.edu' });
    expect(link).toHaveAttribute('href', 'mailto:ada@x.edu');
  });
});
