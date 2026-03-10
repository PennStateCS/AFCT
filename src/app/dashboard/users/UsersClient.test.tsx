/** @vitest-environment jsdom */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import UsersClient from './UsersClient';
import type { UserListItem } from '@/lib/users-list';

const replaceMock = vi.hoisted(() => vi.fn());
const getUserColumnsMock = vi.hoisted(() => vi.fn(() => []));
const searchState = vi.hoisted(() => ({ create: '' }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock }),
  useSearchParams: () => ({
    get: (key: string) => (key === 'create' ? searchState.create : null),
    toString: () => (searchState.create ? 'create=open' : ''),
  }),
}));

vi.mock('@/hooks/use-effective-timezone', () => ({
  useEffectiveTimezone: () => ({ timezone: 'UTC' }),
}));

vi.mock('./user-columns', () => ({
  getUserColumns: getUserColumnsMock,
}));

vi.mock('@/components/ui/data-table', () => ({
  DataTable: ({ data, loading }: { data: UserListItem[]; loading?: boolean }) => (
    <div>
      <div data-testid="table-loading">{String(!!loading)}</div>
      <div data-testid="table-rows">{data.length}</div>
    </div>
  ),
}));

vi.mock('@/components/dialogs/CreateUserDialog', () => ({
  CreateUserDialog: ({
    open,
    setOpen,
  }: {
    open: boolean;
    setOpen: (open: boolean) => void;
    onSuccess: () => void;
  }) => (
    <div>
      <div data-testid="create-dialog-state">{open ? 'open' : 'closed'}</div>
      <button type="button" onClick={() => setOpen(false)}>
        Close Dialog
      </button>
    </div>
  ),
}));

vi.mock('@/components/dialogs/ImportUsersDialog', () => ({
  ImportUsersDialog: ({
    open,
    setOpen,
  }: {
    open: boolean;
    setOpen: (open: boolean) => void;
    onSuccess: () => void;
  }) => (
    <div>
      <div data-testid="bulk-dialog-state">{open ? 'open' : 'closed'}</div>
      <button type="button" onClick={() => setOpen(false)}>
        Close Bulk Dialog
      </button>
    </div>
  ),
}));

describe('UsersClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchState.create = '';
    vi.stubGlobal('fetch', vi.fn());
  });

  it('renders server-provided users without initial fetch', () => {
    const users: UserListItem[] = [
      {
        id: 'u1',
        email: 'a@example.com',
        firstName: 'Ada',
        lastName: 'Lovelace',
        role: 'ADMIN',
        avatar: null,
        timezone: 'UTC',
        inactive: false,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ];

    render(<UsersClient initialUsers={users} />);

    expect(screen.getByTestId('table-loading').textContent).toBe('false');
    expect(screen.getByTestId('table-rows').textContent).toBe('1');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('fetches users on mount when no initial users are provided', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => [
        {
          id: 'u2',
          email: 'u2@example.com',
          firstName: 'Alan',
          lastName: 'Turing',
          role: 'STUDENT',
          avatar: null,
          timezone: 'UTC',
          inactive: false,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      ],
    });

    render(<UsersClient />);

    expect(screen.getByTestId('table-loading').textContent).toBe('true');

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/users/list', { cache: 'no-store' });
      expect(screen.getByTestId('table-rows').textContent).toBe('1');
      expect(screen.getByTestId('table-loading').textContent).toBe('false');
    });
  });

  it('shows error banner and retries successfully', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({}) }).mockResolvedValueOnce({
      ok: true,
      json: async () => [
        {
          id: 'u3',
          email: 'u3@example.com',
          firstName: 'Grace',
          lastName: 'Hopper',
          role: 'FACULTY',
          avatar: null,
          timezone: 'UTC',
          inactive: false,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      ],
    });

    render(<UsersClient />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Failed to load users. Please try again.',
      );
    });

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => {
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.getByTestId('table-rows').textContent).toBe('1');
    });
  });

  it('opens dialog from query string and clears query on close', () => {
    searchState.create = 'open';

    render(<UsersClient initialUsers={[]} />);

    expect(screen.getByTestId('create-dialog-state')).toHaveTextContent('open');

    fireEvent.click(screen.getByRole('button', { name: 'Close Dialog' }));

    expect(replaceMock).toHaveBeenCalledWith('?', { scroll: false });
  });

  it('memoizes table columns across local state updates', async () => {
    const users: UserListItem[] = [
      {
        id: 'u1',
        email: 'a@example.com',
        firstName: 'Ada',
        lastName: 'Lovelace',
        role: 'ADMIN',
        avatar: null,
        timezone: 'UTC',
        inactive: false,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ];

    render(<UsersClient initialUsers={users} />);

    expect(getUserColumnsMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Create User' }));

    await waitFor(() => {
      expect(screen.getByTestId('create-dialog-state')).toHaveTextContent('open');
    });

    expect(getUserColumnsMock).toHaveBeenCalledTimes(1);
  });

  it('opens import users dialog from button click', async () => {
    render(<UsersClient initialUsers={[]} />);

    expect(screen.getByTestId('bulk-dialog-state')).toHaveTextContent('closed');

    fireEvent.click(screen.getByRole('button', { name: 'Import Users' }));

    await waitFor(() => {
      expect(screen.getByTestId('bulk-dialog-state')).toHaveTextContent('open');
    });
  });
});
