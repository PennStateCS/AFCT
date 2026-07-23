/** @vitest-environment jsdom */

import React from 'react';
import '@/components/ui/data-table';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ColumnDef } from '@tanstack/react-table';

import { DataTable } from './data-table';
import { Button } from './button';

interface RowData {
  id: string;
  name: string;
  role: string;
}

const columns: ColumnDef<RowData>[] = [
  {
    accessorKey: 'name',
    header: 'Name',
    cell: ({ getValue }) => <span>{getValue<string>()}</span>,
    meta: { priority: 1 },
  },
  {
    accessorKey: 'role',
    header: 'Role',
    cell: ({ getValue }) => <span>{getValue<string>()}</span>,
    meta: { priority: 2 },
  },
];

const data: RowData[] = [
  { id: '1', name: 'Alice', role: 'Admin' },
  { id: '2', name: 'Bob', role: 'Student' },
  { id: '3', name: 'Carol', role: 'TA' },
];

describe('DataTable', () => {
  const createObjectURL = vi.fn(() => 'blob:mock');
  const revokeObjectURL = vi.fn();
  const clickMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    if (!(globalThis as any).URL) {
      (globalThis as any).URL = {};
    }
    (URL as any).createObjectURL = createObjectURL;
    (URL as any).revokeObjectURL = revokeObjectURL;
    vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
      const element = document.createElementNS('http://www.w3.org/1999/xhtml', tagName);
      element.click = clickMock;
      return element as HTMLElement;
    }) as unknown as typeof document.createElement);
    clickMock.mockReset();
    // Popover/Command (Radix + cmdk) call scrollIntoView, which jsdom lacks.
    (Element.prototype as any).scrollIntoView = vi.fn();
  });

  afterEach(() => {
    // Leave the desktop (no matchMedia) default in place for other tests.
    delete (window as any).matchMedia;
  });

  it('filters rows with the global search input', async () => {
    const user = userEvent.setup();
    render(<DataTable columns={columns} data={data} />);

    await user.type(screen.getByPlaceholderText('Search...'), 'Bob');

    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.queryByText('Alice')).not.toBeInTheDocument();
  });

  it('exports visible rows to CSV', () => {
    render(<DataTable columns={columns} data={data} storageKey="test-table" />);

    fireEvent.click(screen.getByRole('button', { name: /export table data to csv/i }));

    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(clickMock).toHaveBeenCalledTimes(1);
  });

  it('exports every filtered row, not just the page on screen', async () => {
    // 12 rows against a default page size of 10: the last two are off-page, and used
    // to be silently dropped from the export.
    const many: RowData[] = Array.from({ length: 12 }, (_, i) => ({
      id: String(i),
      name: `Person ${i}`,
      role: 'Student',
    }));
    render(<DataTable columns={columns} data={many} storageKey="test-export-all" />);

    expect(screen.queryByText('Person 11')).not.toBeInTheDocument(); // off-page

    fireEvent.click(screen.getByRole('button', { name: /export table data to csv/i }));

    // The mock is declared with no parameters, so its recorded call tuple is empty
    // as far as TS is concerned; assert the shape we actually pass.
    const [blob] = createObjectURL.mock.calls[0] as unknown as [Blob];
    const csv = await blob.text();
    expect(csv).toContain('Person 0');
    expect(csv).toContain('Person 11');
    expect(csv.trim().split('\n')).toHaveLength(13); // header + 12 rows
  });

  it('shows the row total, and a filtered count while searching', async () => {
    const user = userEvent.setup();
    render(<DataTable columns={columns} data={data} />);

    expect(screen.getByText('3 total')).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText('Search...'), 'Bob');

    expect(await screen.findByText('1 of 3')).toBeInTheDocument();
  });

  it('restores a saved rows-per-page preference', async () => {
    localStorage.setItem('test-page-size-page-size', '25');
    const many: RowData[] = Array.from({ length: 12 }, (_, i) => ({
      id: String(i),
      name: `Person ${i}`,
      role: 'Student',
    }));

    render(<DataTable columns={columns} data={many} storageKey="test-page-size" />);

    // All 12 fit on one page at 25/page; at the default 10 the last two would be hidden.
    expect(await screen.findByText('Person 11')).toBeInTheDocument();
  });

  it('renders an empty-state action when one is provided', () => {
    render(
      <DataTable
        columns={columns}
        data={[]}
        emptyTitle="No courses yet"
        emptyAction={<button>Create Course</button>}
      />,
    );

    expect(screen.getByRole('button', { name: 'Create Course' })).toBeInTheDocument();
  });

  it('names the sort button with the visible header text (WCAG 2.5.3)', () => {
    // An aria-label here would override the visible text -- and since columnLabel()
    // prefers meta.filterLabel, it could announce a word that isn't on screen.
    render(<DataTable columns={columns} data={data} />);

    expect(screen.getByRole('button', { name: 'Name' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /sort by name/i })).not.toBeInTheDocument();
  });

  it('announces pagination state through a single live region', () => {
    const { container } = render(<DataTable columns={columns} data={data} />);

    // Two live regions (page indicator + row total) meant one page change fired two
    // separate announcements.
    const live = container.querySelectorAll('[aria-live], [role="status"]');
    expect(live).toHaveLength(1);
    expect(live[0]).toHaveTextContent('Page 1 of 1, 3 total');
  });

  it('only makes the header sticky when asked', () => {
    const { rerender, container } = render(<DataTable columns={columns} data={data} />);
    expect(container.querySelector('thead')).not.toHaveClass('sticky');

    rerender(<DataTable columns={columns} data={data} stickyHeader />);
    expect(container.querySelector('thead')).toHaveClass('sticky');
  });

  it('renders loading state when loading is true', () => {
    render(<DataTable columns={columns} data={[]} loading />);

    expect(screen.getByText(/Loading data, please wait/i)).toBeInTheDocument();
    expect(screen.getByText(/Loading data, please wait/i).closest('tr')).toHaveClass(
      'hover:bg-transparent',
    );
  });

  it('uses a custom loading message when one is provided', () => {
    render(<DataTable columns={columns} data={[]} loading loadingMessage="Loading courses..." />);

    expect(screen.getByText('Loading courses...')).toBeInTheDocument();
    expect(screen.queryByText(/Loading data, please wait/i)).not.toBeInTheDocument();
  });

  it('renders custom action buttons in the toolbar', () => {
    render(
      <DataTable
        columns={columns}
        data={data}
        actionButtons={<Button aria-label="custom refresh">Refresh</Button>}
      />,
    );

    expect(screen.getByRole('button', { name: /custom refresh/i })).toBeInTheDocument();
  });

  it('does not warn when rows lack id/_id values', () => {
    const spy = vi.spyOn(console, 'error');
    type NoId = { name: string; role: string };
    const noIdColumns: ColumnDef<NoId>[] = columns as unknown as ColumnDef<NoId>[];
    const noIdData: NoId[] = [
      { name: 'Foo', role: 'X' },
      { name: 'Bar', role: 'Y' },
    ];

    render(<DataTable columns={noIdColumns as any} data={noIdData as any} />);
    expect(spy).not.toHaveBeenCalledWith(
      expect.stringContaining('Encountered two children with the same key'),
    );
  });

  it('filters rows with a faceted value filter', async () => {
    const user = userEvent.setup();
    const facetColumns: ColumnDef<RowData>[] = [
      { accessorKey: 'name', header: 'Name', meta: { priority: 1 } },
      {
        accessorKey: 'role',
        header: 'Role',
        meta: { priority: 2, filterVariant: 'multiselect' },
      },
    ];

    render(<DataTable columns={facetColumns} data={data} />);

    // Open the combined Filters popover and tick "Admin" under the Role section.
    await user.click(screen.getByRole('button', { name: 'Filters' }));
    await user.click(await screen.findByRole('checkbox', { name: /^admin/i }));

    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.queryByText('Bob')).not.toBeInTheDocument();
    expect(screen.queryByText('Carol')).not.toBeInTheDocument();

    // A "Clear all" affordance appears while a filter is active.
    expect(screen.getByRole('button', { name: /clear all/i })).toBeInTheDocument();
  });

  it('does not render a Filters button when no column opts in', () => {
    render(<DataTable columns={columns} data={data} />);
    expect(screen.queryByRole('button', { name: 'Filters' })).not.toBeInTheDocument();
  });

  it('offers a search scope selector for searchable columns', () => {
    render(<DataTable columns={columns} data={data} />);
    expect(screen.getByRole('combobox', { name: /search scope/i })).toBeInTheDocument();
  });

  it('renders a stacked card view on small screens', async () => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as unknown as typeof window.matchMedia;

    render(<DataTable columns={columns} data={data} />);

    // The effect flips to the card view; the desktop <table> is gone.
    expect(await screen.findByText('Alice')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    // Each card labels its values with the column header (one per row).
    expect(screen.getAllByText('Role').length).toBeGreaterThan(1);
  });
});
