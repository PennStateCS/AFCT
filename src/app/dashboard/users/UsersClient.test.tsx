/** @vitest-environment jsdom */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import UsersClient from './UsersClient';
import type { UserListItem } from '@/lib/users-list';

// Render with a fresh QueryClient per test (retry off, no lingering cache) so the
// users query starts clean each time.
const renderWithClient = (ui: React.ReactElement) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
};

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

vi.mock('@/components/ui/data-table-faceted-filter', () => ({
  DataTableFilterMenu: () => <div data-testid="filter-menu" />,
}));

vi.mock('@/components/dialogs/CreateUserDialog', () => ({
  CreateUserDialog: ({ open, setOpen }: { open: boolean; setOpen: (open: boolean) => void }) => (
    <div>
      <div data-testid="create-dialog-state">{open ? 'open' : 'closed'}</div>
      <button type="button" onClick={() => setOpen(false)}>
        Close Dialog
      </button>
    </div>
  ),
}));

vi.mock('@/components/dialogs/ImportUsersDialog', () => ({
  ImportUsersDialog: ({ open, setOpen }: { open: boolean; setOpen: (open: boolean) => void }) => (
    <div>
      <div data-testid="bulk-dialog-state">{open ? 'open' : 'closed'}</div>
      <button type="button" onClick={() => setOpen(false)}>
        Close Bulk Dialog
      </button>
    </div>
  ),
}));

// A page response with `count` empty rows and the given total.
const pageResponse = (count: number, total = count) => ({
  ok: true,
  json: async () => ({ rows: Array.from({ length: count }, () => ({})), total }),
});

describe('UsersClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchState.create = '';
    // Default: one empty page. Individual tests override as needed.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(pageResponse(0)));
  });

  it('fetches the first page from the paginated endpoint on mount', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(pageResponse(1));

    renderWithClient(<UsersClient />);

    expect(screen.getByTestId('table-loading').textContent).toBe('true');

    await waitFor(() => {
      expect(screen.getByTestId('table-rows').textContent).toBe('1');
      expect(screen.getByTestId('table-loading').textContent).toBe('false');
    });

    const url = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toMatch(/^\/api\/admin\/users\/list\?/);
    expect(url).toContain('page=1');
    expect(url).toContain('pageSize=10');
    expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1]).toEqual({
      cache: 'no-store',
    });
  });

  it('shows error banner and retries successfully', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({}) });
    fetchMock.mockResolvedValueOnce(pageResponse(1));

    renderWithClient(<UsersClient />);

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

    renderWithClient(<UsersClient />);

    expect(screen.getByTestId('create-dialog-state')).toHaveTextContent('open');

    fireEvent.click(screen.getByRole('button', { name: 'Close Dialog' }));

    expect(replaceMock).toHaveBeenCalledWith('?', { scroll: false });
  });

  it('memoizes table columns across local state updates', async () => {
    renderWithClient(<UsersClient />);

    await waitFor(() => {
      expect(screen.getByTestId('table-loading').textContent).toBe('false');
    });
    expect(getUserColumnsMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Create User' }));

    await waitFor(() => {
      expect(screen.getByTestId('create-dialog-state')).toHaveTextContent('open');
    });

    expect(getUserColumnsMock).toHaveBeenCalledTimes(1);
  });

  it('opens import users dialog from button click', async () => {
    renderWithClient(<UsersClient />);

    expect(screen.getByTestId('bulk-dialog-state')).toHaveTextContent('closed');

    fireEvent.click(screen.getByRole('button', { name: 'Import Users' }));

    await waitFor(() => {
      expect(screen.getByTestId('bulk-dialog-state')).toHaveTextContent('open');
    });
  });
});
