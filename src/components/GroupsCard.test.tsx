/** @vitest-environment jsdom */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GroupsCard } from './GroupsCard';

// Render with a fresh QueryClient per test (retry off, no lingering cache) so
// the groups/students queries start clean each time. Returns the client too so
// tests can pre-seed course cache entries.
const renderWithClient = (ui: React.ReactElement) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return { client, ...render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>) };
};

vi.mock('@/hooks/use-effective-timezone', () => ({
  useEffectiveTimezone: () => ({ timezone: 'UTC' }),
}));

vi.mock('@/lib/toast', () => ({
  showToast: { success: vi.fn(), error: vi.fn() },
}));

// Render the group rows so we can assert on rendered group content.
vi.mock('@/components/ui/data-table', () => ({
  DataTable: ({ data, loading }: { data: Array<{ id: string; name: string }>; loading?: boolean }) => (
    <div>
      <div data-testid="table-loading">{String(!!loading)}</div>
      <div data-testid="table-rows">{data.length}</div>
      <ul>
        {data.map((g) => (
          <li key={g.id}>{g.name}</li>
        ))}
      </ul>
    </div>
  ),
}));

// Heavy dialogs: expose their success callback via a button so we can trigger
// the post-mutation invalidation path.
vi.mock('@/components/dialogs/CreateGroupsDialog', () => ({
  CreateGroupDialog: ({ onSuccess }: { onSuccess: () => void }) => (
    <button type="button" onClick={onSuccess}>
      Trigger Create Success
    </button>
  ),
}));
vi.mock('@/components/dialogs/EditGroupsDialog', () => ({
  EditGroupDialog: () => null,
}));
vi.mock('@/components/dialogs/ManageGroupDialog', () => ({
  default: () => null,
}));
vi.mock('@/components/dialogs/RandomGroupsDialog', () => ({
  default: () => null,
}));
vi.mock('@/components/dialogs/ConfirmDialog', () => ({
  ConfirmDialog: () => null,
}));

type FetchMock = ReturnType<typeof vi.fn>;

const jsonResponse = (body: unknown, ok = true) => ({
  ok,
  json: async () => body,
});

// URL/method router: both the groups and students endpoints are plain GETs, so
// we branch on both method and path.
const routeFetch = (opts: {
  groups?: unknown;
  students?: unknown;
  onGroupsList?: () => void;
}): FetchMock =>
  vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (url === '/api/courses/c1/groups' && method === 'GET') {
      opts.onGroupsList?.();
      return jsonResponse(opts.groups ?? []);
    }
    if (url === '/api/courses/c1/students' && method === 'GET') {
      return jsonResponse(opts.students ?? []);
    }
    throw new Error(`Unexpected fetch: ${method} ${url}`);
  });

describe('GroupsCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches both groups and students on mount and renders group content', async () => {
    const fetchMock = routeFetch({
      groups: [{ id: 'g1', name: 'Team Alpha', createdAt: new Date().toISOString() }],
      students: [{ id: 's1', firstName: 'Ada' }],
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithClient(<GroupsCard courseId="c1" />);

    await waitFor(() => {
      expect(screen.getByText('Team Alpha')).toBeInTheDocument();
    });

    // Groups list fired as a plain GET.
    expect(fetchMock).toHaveBeenCalledWith('/api/courses/c1/groups');
    // Students GET fired.
    expect(fetchMock).toHaveBeenCalledWith('/api/courses/c1/students');
  });

  it('seeds students from the cached course roster and skips the /students fetch', async () => {
    const fetchMock = routeFetch({
      groups: [{ id: 'g1', name: 'Team Alpha', createdAt: new Date().toISOString() }],
      // If the seed works, students is never requested; this would be an error if hit.
      students: [{ id: 'should-not-be-used' }],
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    // Pre-seed the course cache the way the course page does (base `summary` view
    // carries the enrolled roster with courseRole tags).
    client.setQueryData(['course', 'c1', 'summary'], {
      id: 'c1',
      enrolled: [
        { id: 's1', firstName: 'Ada', lastName: 'L', email: 'ada@x.io', courseRole: 'STUDENT' },
        { id: 'f1', firstName: 'Fac', lastName: 'Ulty', email: 'f@x.io', courseRole: 'FACULTY' },
      ],
    });

    render(
      <QueryClientProvider client={client}>
        <GroupsCard courseId="c1" />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('Team Alpha')).toBeInTheDocument();
    });

    // Groups still fetched, but students came from the seed: no GET /students.
    expect(fetchMock).toHaveBeenCalledWith('/api/courses/c1/groups');
    expect(fetchMock).not.toHaveBeenCalledWith('/api/courses/c1/students');

    // Only the STUDENT-role member is seeded into the students query cache.
    expect(client.getQueryData(['course', 'c1', 'students'])).toEqual([
      { id: 's1', firstName: 'Ada', lastName: 'L', email: 'ada@x.io', avatar: null },
    ]);
  });

  it('shows a loading state until the groups query resolves', async () => {
    let resolveGroups!: (v: unknown) => void;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (url === '/api/courses/c1/groups' && method === 'GET') {
        return new Promise((resolve) => {
          resolveGroups = () => resolve(jsonResponse([]));
        });
      }
      return jsonResponse([]);
    });
    vi.stubGlobal('fetch', fetchMock as unknown as FetchMock);

    renderWithClient(<GroupsCard courseId="c1" />);

    // Groups query is pending -> loading true.
    expect(screen.getByTestId('table-loading').textContent).toBe('true');

    resolveGroups(null);

    await waitFor(() => {
      expect(screen.getByTestId('table-loading').textContent).toBe('false');
    });
  });

  it('re-fetches the groups list after a create mutation succeeds', async () => {
    const onGroupsList = vi.fn();
    const fetchMock = routeFetch({
      groups: [{ id: 'g1', name: 'Team Alpha', createdAt: new Date().toISOString() }],
      students: [],
      onGroupsList,
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithClient(<GroupsCard courseId="c1" />);

    await waitFor(() => {
      expect(onGroupsList).toHaveBeenCalledTimes(1);
    });

    // A successful create triggers invalidation -> the active groups query refetches.
    fireEvent.click(screen.getByRole('button', { name: 'Trigger Create Success' }));

    await waitFor(() => {
      expect(onGroupsList).toHaveBeenCalledTimes(2);
    });
  });
});
