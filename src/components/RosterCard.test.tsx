/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import type { User } from '@prisma/client';
import { RosterCard } from './RosterCard';

const renderWithClient = (ui: React.ReactElement) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
};

// The Filters control is a Radix popover, which needs pointer capture jsdom lacks. Render
// its content inline so the role/status checkboxes are queryable.
vi.mock('@/components/ui/popover', () => {
  const Pass = ({ children }: { children: React.ReactNode }) => <>{children}</>;
  return {
    Popover: Pass,
    PopoverTrigger: Pass,
    PopoverContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    PopoverAnchor: Pass,
  };
});

const columns = [
  { accessorKey: 'lastName', header: 'Last Name', meta: { priority: 1 } },
  { accessorKey: 'email', header: 'Email', meta: { priority: 2 } },
] as unknown as ColumnDef<User>[];

const MEMBERS = [
  {
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
  },
];

type FetchMock = ReturnType<typeof vi.fn>;

const page = (rows: unknown[], total = rows.length) => ({
  ok: true,
  json: async () => ({ rows, total }),
});

/** The URL of the most recent roster request. */
const lastUrl = (fetchMock: FetchMock) =>
  String(fetchMock.mock.calls[fetchMock.mock.calls.length - 1][0]);

const install = (rows: unknown[] = MEMBERS, total = rows.length) => {
  const fetchMock = global.fetch as FetchMock;
  fetchMock.mockImplementation(async () => page(rows, total));
  return fetchMock;
};

const renderCard = () =>
  renderWithClient(
    <RosterCard
      courseId="c1"
      courseIsArchived={false}
      userColumns={columns}
      onEnrollUser={vi.fn()}
      onBulkEnroll={vi.fn()}
    />,
  );

describe('RosterCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  it('asks the server for the first page and renders the returned rows', async () => {
    const fetchMock = install();

    renderCard();

    await waitFor(() => expect(screen.getByText('ada@x.edu')).toBeInTheDocument());
    expect(lastUrl(fetchMock)).toContain('/api/courses/c1/roster');
    expect(lastUrl(fetchMock)).toContain('page=1');
  });

  it('reports the server total rather than the rows on screen', async () => {
    install(MEMBERS, 1200);

    renderCard();

    await waitFor(() => expect(screen.getByText('ada@x.edu')).toBeInTheDocument());
    // One row held, 1,200 in the course: the pager counts the whole roster.
    expect(screen.getAllByText(/Page 1 of 120/).length).toBeGreaterThan(0);
  });

  it('asks the server for the next page instead of slicing what it holds', async () => {
    const fetchMock = install(MEMBERS, 1200);

    renderCard();
    await waitFor(() => expect(screen.getByText('ada@x.edu')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /next page/i }));

    await waitFor(() => expect(lastUrl(fetchMock)).toContain('page=2'));
  });

  it('sends a sort to the server and returns to the first page', async () => {
    const fetchMock = install(MEMBERS, 1200);

    renderCard();
    await waitFor(() => expect(screen.getByText('ada@x.edu')).toBeInTheDocument());

    const table = screen.getByRole('table');
    fireEvent.click(within(table).getByRole('button', { name: /^Last Name/ }));

    await waitFor(() => {
      expect(lastUrl(fetchMock)).toContain('sortBy=lastName');
      expect(lastUrl(fetchMock)).toContain('page=1');
    });
  });

  it('sends role and status as separate filters, so they narrow together', async () => {
    const fetchMock = install();

    renderCard();
    await waitFor(() => expect(screen.getByText('ada@x.edu')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('checkbox', { name: 'Student' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Dropped' }));

    await waitFor(() => {
      const url = lastUrl(fetchMock);
      expect(url).toContain('role=STUDENT');
      expect(url).toContain('status=DROPPED');
    });
  });

  it('says the filters are the reason when a narrowed roster comes back empty', async () => {
    const fetchMock = global.fetch as FetchMock;
    fetchMock.mockImplementation(async (url: string) =>
      String(url).includes('role=') ? page([]) : page(MEMBERS),
    );

    renderCard();
    await waitFor(() => expect(screen.getByText('ada@x.edu')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('checkbox', { name: 'Faculty' }));

    await waitFor(() =>
      expect(screen.getByText('No one matches your filters')).toBeInTheDocument(),
    );
  });

  it('offers no CSV export, because the browser only holds one page', async () => {
    install();

    renderCard();
    await waitFor(() => expect(screen.getByText('ada@x.edu')).toBeInTheDocument());

    expect(screen.queryByRole('button', { name: /export/i })).not.toBeInTheDocument();
  });

  it('surfaces a failed load with a retry', async () => {
    const fetchMock = global.fetch as FetchMock;
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) });

    renderCard();

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Failed to load the roster'),
    );
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
