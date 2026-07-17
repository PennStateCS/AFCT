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

  it('renders loading state when loading is true', () => {
    render(<DataTable columns={columns} data={[]} loading />);

    expect(screen.getByText(/Loading data, please wait/i)).toBeInTheDocument();
    expect(screen.getByText(/Loading data, please wait/i).closest('tr')).toHaveClass(
      'hover:bg-transparent',
    );
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

    // Open the Role value filter and pick "Admin".
    await user.click(screen.getByRole('button', { name: 'Role' }));
    await user.click(await screen.findByRole('option', { name: /admin/i }));

    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.queryByText('Bob')).not.toBeInTheDocument();
    expect(screen.queryByText('Carol')).not.toBeInTheDocument();

    // A "Clear filters" affordance appears while a filter is active.
    expect(screen.getByRole('button', { name: /clear filters/i })).toBeInTheDocument();
  });

  it('does not render a value-filter row when no column opts in', () => {
    render(<DataTable columns={columns} data={data} />);
    // No faceted filter button for plain columns.
    expect(screen.queryByRole('button', { name: 'Role' })).not.toBeInTheDocument();
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
