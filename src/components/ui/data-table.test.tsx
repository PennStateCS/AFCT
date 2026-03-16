/** @vitest-environment jsdom */

import React from 'react';
import '@/components/ui/data-table';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ColumnDef } from '@tanstack/react-table';

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
});
