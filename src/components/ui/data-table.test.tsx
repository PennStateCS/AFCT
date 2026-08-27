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

  it('adds gridline classes to the table only when bordered is set', () => {
    const { rerender } = render(<DataTable columns={columns} data={data} showToolbar={false} />);
    expect(screen.getByRole('table').className).not.toContain('border-r');

    rerender(<DataTable columns={columns} data={data} showToolbar={false} bordered />);
    expect(screen.getByRole('table').className).toContain('[&_td:not(:last-child)]:border-r');
  });

  it('applies whitespace-nowrap to a body cell only when the column sets meta.nowrap', () => {
    const cols: ColumnDef<RowData>[] = [
      {
        accessorKey: 'name',
        header: 'Name',
        cell: ({ getValue }) => <span>{getValue<string>()}</span>,
      },
      {
        accessorKey: 'role',
        header: 'Role',
        cell: ({ getValue }) => <span>{getValue<string>()}</span>,
        meta: { nowrap: true },
      },
    ];
    render(<DataTable columns={cols} data={[{ id: '1', name: 'Alice', role: 'Admin' }]} />);
    // Cells wrap by default; only the opted-in column stays on one line.
    expect(screen.getByText('Alice').closest('td')?.className).not.toContain('whitespace-nowrap');
    expect(screen.getByText('Admin').closest('td')?.className).toContain('whitespace-nowrap');
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

  it('says which rows are on screen, and what a search is hiding', async () => {
    const user = userEvent.setup();
    render(<DataTable columns={columns} data={data} />);

    expect(screen.getByText('Showing 1-3 of 3 records')).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText('Search...'), 'Bob');

    expect(await screen.findByText('Showing 1 of 1 record, filtered from 3')).toBeInTheDocument();
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

  it('renders a row-header cell (th scope="row") only for the column that opts in', () => {
    const cols: ColumnDef<RowData>[] = [
      {
        accessorKey: 'name',
        header: 'Name',
        cell: ({ getValue }) => <span>{getValue<string>()}</span>,
        meta: { priority: 1, rowHeader: true },
      },
      {
        accessorKey: 'role',
        header: 'Role',
        cell: ({ getValue }) => <span>{getValue<string>()}</span>,
        meta: { priority: 1 },
      },
    ];
    render(<DataTable columns={cols} data={[{ id: '1', name: 'Alice', role: 'Admin' }]} />);

    // The identity cell is a scoped row header so a screen reader ties each grade cell
    // to the student; the other cell stays a plain td.
    const rowHeader = screen.getByText('Alice').closest('th');
    expect(rowHeader).not.toBeNull();
    expect(rowHeader).toHaveAttribute('scope', 'row');
    expect(screen.getByText('Admin').closest('th')).toBeNull();
  });

  it('gives the empty state a status role so a filter-to-empty is announced', () => {
    render(<DataTable columns={columns} data={[]} emptyTitle="No courses yet" />);

    // The empty-state wrapper is its own live region, so narrowing a filter to zero rows
    // is announced rather than leaving the table silently blank.
    const status = screen.getByText('No courses yet').closest('[role="status"]');
    expect(status).not.toBeNull();
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
    expect(live[0]).toHaveTextContent('Page 1 of 1, Showing 1-3 of 3 records');
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

  /*
   * The toolbar belongs to the table, so it is drawn on the table.
   *
   * It used to sit outside the bordered shell, on the page: Search and Filters floating above
   * the rows they act on, with nothing joining them. That was invisible while every table sat
   * inside a white card, and became obvious once the shell started painting its own surface,
   * because the toolbar was then the one part showing the page through itself.
   *
   * jsdom does no layout, so this checks containment rather than pixels. That is the part a
   * refactor would undo: moving the toolbar back out is a one-line change and looks harmless.
   */
  it('draws the toolbar inside the table shell, not above it', () => {
    const { container } = render(<DataTable columns={columns} data={data} />);

    const shell = container.querySelector('div.overflow-hidden.rounded-md.border')!;
    expect(shell).toBeInTheDocument();
    expect(shell).toContainElement(screen.getByRole('button', { name: /Columns/i }));
    expect(shell).toContainElement(screen.getByRole('textbox'));
    // Same shell, so the search box and the rows are one object rather than two.
    expect(shell).toContainElement(container.querySelector('table')!);
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

  it('splits one column across filter headings and still ORs the picks', async () => {
    const user = userEvent.setup();
    const sectionColumns: ColumnDef<RowData>[] = [
      { accessorKey: 'name', header: 'Name', meta: { priority: 1 } },
      {
        accessorKey: 'role',
        header: 'Role',
        meta: {
          priority: 2,
          filterVariant: 'multiselect',
          filterSections: [
            { label: 'Staff', options: [{ label: 'Admin', value: 'Admin' }] },
            {
              label: 'Enrolled',
              options: [
                { label: 'Student', value: 'Student' },
                { label: 'TA', value: 'TA' },
              ],
            },
          ],
        },
      },
    ];

    render(<DataTable columns={sectionColumns} data={data} />);
    await user.click(screen.getByRole('button', { name: 'Filters' }));

    // Both headings label a group of their own, rather than one undivided list.
    expect(await screen.findByRole('group', { name: 'Staff' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Enrolled' })).toBeInTheDocument();

    // Ticking one value from each heading widens rather than producing an empty
    // intersection, because both write to the same column filter.
    await user.click(screen.getByRole('checkbox', { name: /^admin/i }));
    await user.click(screen.getByRole('checkbox', { name: /^TA/ }));

    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Carol')).toBeInTheDocument();
    expect(screen.queryByText('Bob')).not.toBeInTheDocument();
  });

  /*
   * The toolbar's visual hierarchy, asserted through the tokens that carry it rather than
   * through whole class strings: neutral utilities, an outlined Export, and cobalt kept for
   * the one state in the family (filters are on) and for a page's own primary action.
   *
   * Class names are a blunt instrument for this, but the alternative is a screenshot nobody
   * runs. These pin the three distinctions that make the hierarchy readable, and nothing
   * about padding or radius, so a restyle does not have to come here first.
   */
  describe('toolbar hierarchy', () => {
    const facetColumns: ColumnDef<RowData>[] = [
      { accessorKey: 'name', header: 'Name', meta: { priority: 1 } },
      { accessorKey: 'role', header: 'Role', meta: { priority: 2, filterVariant: 'multiselect' } },
    ];

    it('keeps Filters and Columns neutral siblings while nothing is filtered', () => {
      render(<DataTable columns={facetColumns} data={data} />);

      const filters = screen.getByRole('button', { name: 'Filters' });
      const cols = screen.getByRole('button', { name: 'Columns' });

      expect(filters.className).toContain('bg-muted');
      expect(cols.className).toContain('bg-muted');
      // No cobalt at rest: a view control is not a state until it is doing something.
      expect(filters.className).not.toContain('tab-active');
      expect(cols.className).not.toContain('tab-active');
    });

    it('tints Filters, and counts them, once a filter is on', async () => {
      const user = userEvent.setup();
      render(<DataTable columns={facetColumns} data={data} />);

      await user.click(screen.getByRole('button', { name: 'Filters' }));
      await user.click(await screen.findByRole('checkbox', { name: /^admin/i }));

      // The accessible name carries the state too, so it does not rest on the tint.
      const active = screen.getByRole('button', { name: 'Filters, 1 active' });
      expect(active.className).toContain('bg-tab-active-bg');
      expect(active.className).toContain('text-tab-active');
      expect(active).toHaveTextContent('1');
      // Columns is not a state indicator and stays where it was.
      expect(screen.getByRole('button', { name: 'Columns' }).className).not.toContain('tab-active');
    });

    it('keeps Export outlined: an action on the data, not a primary one', () => {
      render(<DataTable columns={facetColumns} data={data} />);

      const exportButton = screen.getByRole('button', { name: /export table data/i });
      expect(exportButton.className).toContain('border-input');
      expect(exportButton.className).toContain('bg-card');
      // Not primary, and not a semantic colour: a CSV is not a success.
      expect(exportButton.className).not.toContain('bg-primary');
      expect(exportButton.className).not.toContain('status-success');
    });

    it('leaves a page action passed into the toolbar alone', () => {
      render(
        <DataTable
          columns={facetColumns}
          data={data}
          actionButtons={<Button>Create Course</Button>}
        />,
      );

      expect(screen.getByRole('button', { name: 'Create Course' }).className).toContain(
        'bg-primary',
      );
    });
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

  it('lets a value that refuses to wrap wrap once it is in a card', async () => {
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

    // A cell that pins itself to one line, which is right in a table and impossible in a card.
    const nowrapColumns: ColumnDef<RowData>[] = [
      {
        accessorKey: 'name',
        header: 'Backup taken',
        cell: () => <span className="whitespace-nowrap">Aug 17, 2026 at 1:13:51 AM EDT</span>,
        meta: { priority: 1 },
      },
    ];
    render(<DataTable columns={nowrapColumns} data={[data[0]!]} />);

    const value = await screen.findByText('Aug 17, 2026 at 1:13:51 AM EDT');
    // jsdom does no layout, so this asserts the wiring only: the card's value box carries the
    // override that beats the cell's own nowrap. That it actually stops the overflow was
    // measured in a real browser at 390px, where the value ran 13px past the card's border
    // without it and sat inside on two lines with it.
    expect(value.closest('dd')).toHaveClass('[&_*]:whitespace-normal');
  });

  /*
   * Where a row's actions land once the table becomes cards.
   *
   * The rule the card view implements: an icon-only overflow menu goes in the card's
   * top-right corner, a larger group of controls keeps a footer row, and a table with no
   * actions column gets neither. jsdom does no layout, so these pin the structure the rule
   * produces (which slot the cell rendered into, and that it rendered once), not how it looks.
   */
  describe('actions on a stacked card', () => {
    const stackedViewport = () => {
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
    };

    const kebabColumns: ColumnDef<RowData>[] = [
      ...columns,
      {
        id: 'actions',
        header: 'Actions',
        cell: ({ row }) => <Button aria-label={`Actions for ${row.original.name}`}>⋮</Button>,
      },
    ];

    const footerColumns: ColumnDef<RowData>[] = [
      ...columns,
      {
        id: 'actions',
        header: 'Actions',
        meta: { mobileActionPlacement: 'footer' },
        cell: ({ row }) => <Button aria-label={`Delete ${row.original.name}`}>Delete</Button>,
      },
    ];

    const cardFor = (name: string) => screen.getByText(name).closest('li') as HTMLElement;

    it('puts an overflow menu in the corner, once, and outside the fields', async () => {
      stackedViewport();
      render(<DataTable columns={kebabColumns} data={[data[0]!]} />);

      const trigger = await screen.findByRole('button', { name: 'Actions for Alice' });
      // Once. It used to be possible to render the cell in the body and again in the footer.
      expect(screen.getAllByRole('button', { name: 'Actions for Alice' })).toHaveLength(1);
      // Not a field: it has no label, so it does not belong in the definition list.
      expect(trigger.closest('dl')).toBeNull();
      expect(trigger.closest('dd')).toBeNull();
      expect(trigger.parentElement).toHaveClass('absolute', 'top-2', 'right-2');
    });

    /**
     * The corner overlaps the first field's line, so that line and only that line is inset.
     * A gutter down the whole card would cost every value its width for the sake of one row,
     * and no inset at all puts a long title under the menu.
     */
    it('keeps the first field clear of the corner action', async () => {
      stackedViewport();
      render(<DataTable columns={kebabColumns} data={[data[0]!]} />);

      await screen.findByRole('button', { name: 'Actions for Alice' });

      expect(cardFor('Alice').querySelector('dl')?.className).toContain('[&>*:first-child]:pr-11');
    });

    it('drops the footer and its divider for an overflow menu', async () => {
      stackedViewport();
      render(<DataTable columns={kebabColumns} data={[data[0]!]} />);

      await screen.findByRole('button', { name: 'Actions for Alice' });
      // The lone ellipsis under a rule is exactly what this replaced.
      expect(cardFor('Alice').querySelector('.border-t')).toBeNull();
    });

    it('keeps a footer row for an action group that says it needs one', async () => {
      stackedViewport();
      render(<DataTable columns={footerColumns} data={[data[0]!]} />);

      const button = await screen.findByRole('button', { name: 'Delete Alice' });
      expect(button.parentElement).toHaveClass('border-t');
      expect(button.parentElement).not.toHaveClass('absolute');
      expect(screen.getAllByRole('button', { name: 'Delete Alice' })).toHaveLength(1);
    });

    it('reserves nothing on a table with no actions at all', async () => {
      stackedViewport();
      render(<DataTable columns={columns} data={[data[0]!]} />);

      await screen.findByText('Alice');
      const card = cardFor('Alice');
      expect(card.querySelector('.absolute')).toBeNull();
      expect(card.querySelector('.border-t')).toBeNull();
      // No inset kept for an action that is not there.
      expect(card.querySelector('dl')?.className).not.toContain('pr-11');
    });

    it('still hides a mobileHidden column, and still keeps the card a labelled list', async () => {
      stackedViewport();
      const cols: ColumnDef<RowData>[] = [
        ...kebabColumns.slice(0, 1),
        { ...columns[1]!, meta: { priority: 2, mobileHidden: true } },
        kebabColumns[2]!,
      ];
      render(<DataTable columns={cols} data={[data[0]!]} />);

      await screen.findByText('Alice');
      expect(screen.queryByText('Admin')).not.toBeInTheDocument();
      // Safari/VoiceOver drops list semantics from an unmarked list, hence the explicit role.
      expect(screen.getByRole('list')).toBeInTheDocument();
      expect(cardFor('Alice').tagName).toBe('LI');
      expect(cardFor('Alice').querySelector('dt')?.textContent).toBe('Name');
    });
  });

  /*
   * Server-driven ("manual") mode, used by the Users, System Logs and Autograder pages.
   * The table holds one page and the parent owns pagination, sorting and filtering, so the
   * things asserted here are the ones a client-side table would otherwise do for itself
   * and silently get wrong: counting, slicing, and re-sorting the rows on screen.
   */
  describe('manual (server-driven) mode', () => {
    it('groups a large total so it can be read at a glance', () => {
      render(
        <DataTable
          columns={columns}
          data={data}
          manualPagination
          pageCount={120440}
          rowCount={1204393}
          pagination={{ pageIndex: 0, pageSize: 10 }}
          onPaginationChange={vi.fn()}
        />,
      );

      // Expectation built with the same call the component uses, so this holds wherever
      // the suite runs instead of hard-coding a comma. On any grouping locale (which is
      // to say, in practice) it fails if the label goes back to raw digits.
      const grouped = (1204393).toLocaleString();
      expect(screen.getAllByText(new RegExp(`of ${grouped} records`)).length).toBeGreaterThan(0);
    });

    it('counts pages from pageCount/rowCount rather than the rows it holds', () => {
      render(
        <DataTable
          columns={columns}
          data={data}
          manualPagination
          pageCount={5}
          rowCount={42}
          pagination={{ pageIndex: 0, pageSize: 10 }}
          onPaginationChange={vi.fn()}
        />,
      );

      // Three rows on screen, 42 in the result set.
      expect(screen.getAllByText(/Page 1 of 5/).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/Showing 1-3 of 42 records/).length).toBeGreaterThan(0);
    });

    /**
     * A server-paginated table can shrink under somebody: a log prune, a delete, a filter.
     * Left alone they sit on page 20 of a 19-page result, looking at an empty table and
     * concluding the records are gone.
     */
    it('pulls back to the last page when the result set shrinks', () => {
      const onPaginationChange = vi.fn();
      const { rerender } = render(
        <DataTable
          columns={columns}
          data={data}
          manualPagination
          pageCount={20}
          rowCount={200}
          pagination={{ pageIndex: 19, pageSize: 10 }}
          onPaginationChange={onPaginationChange}
        />,
      );
      expect(onPaginationChange).not.toHaveBeenCalled();

      // The same table, now holding far less.
      rerender(
        <DataTable
          columns={columns}
          data={data}
          manualPagination
          pageCount={3}
          rowCount={25}
          pagination={{ pageIndex: 19, pageSize: 10 }}
          onPaginationChange={onPaginationChange}
        />,
      );

      expect(onPaginationChange).toHaveBeenCalledWith({ pageIndex: 2, pageSize: 10 });
    });

    it('goes to the first page when everything is gone', () => {
      const onPaginationChange = vi.fn();
      render(
        <DataTable
          columns={columns}
          data={[]}
          manualPagination
          pageCount={0}
          rowCount={0}
          pagination={{ pageIndex: 4, pageSize: 10 }}
          onPaginationChange={onPaginationChange}
        />,
      );

      expect(onPaginationChange).toHaveBeenCalledWith({ pageIndex: 0, pageSize: 10 });
    });

    it('leaves a table alone while the total is still unknown', () => {
      const onPaginationChange = vi.fn();
      render(
        <DataTable
          columns={columns}
          data={data}
          manualPagination
          pagination={{ pageIndex: 4, pageSize: 10 }}
          onPaginationChange={onPaginationChange}
        />,
      );

      // No pageCount yet: a page cannot be too high against a total nobody has stated.
      expect(onPaginationChange).not.toHaveBeenCalled();
    });

    it('stays put when the page is the last one exactly', () => {
      const onPaginationChange = vi.fn();
      render(
        <DataTable
          columns={columns}
          data={data}
          manualPagination
          pageCount={5}
          rowCount={50}
          pagination={{ pageIndex: 4, pageSize: 10 }}
          onPaginationChange={onPaginationChange}
        />,
      );

      expect(onPaginationChange).not.toHaveBeenCalled();
    });

    it('reports a page change to the parent instead of paging itself', () => {
      const onPaginationChange = vi.fn();
      render(
        <DataTable
          columns={columns}
          data={data}
          manualPagination
          pageCount={5}
          rowCount={42}
          pagination={{ pageIndex: 0, pageSize: 10 }}
          onPaginationChange={onPaginationChange}
        />,
      );

      fireEvent.click(screen.getByRole('button', { name: /next page/i }));

      expect(onPaginationChange).toHaveBeenCalled();
    });

    it('shows every row it was given, without slicing to the page size', () => {
      render(
        <DataTable
          columns={columns}
          data={data}
          manualPagination
          pageCount={3}
          rowCount={3}
          pagination={{ pageIndex: 0, pageSize: 1 }}
          onPaginationChange={vi.fn()}
        />,
      );

      // pageSize 1, but the server already sliced: all three rows must render.
      expect(screen.getByText('Alice')).toBeInTheDocument();
      expect(screen.getByText('Bob')).toBeInTheDocument();
      expect(screen.getByText('Carol')).toBeInTheDocument();
    });

    it('reports a sort change without reordering the rows on screen', () => {
      const onSortingChange = vi.fn();
      render(
        <DataTable
          columns={columns}
          data={data}
          manualSorting
          sorting={[]}
          onSortingChange={onSortingChange}
        />,
      );

      fireEvent.click(screen.getByRole('button', { name: /^Name/ }));

      expect(onSortingChange).toHaveBeenCalled();
      // Still server order: a client sort here would only reorder this page and claim to
      // have ordered the whole result set.
      const cells = screen.getAllByRole('cell').map((c) => c.textContent);
      expect(cells.slice(0, 2)).toEqual(['Alice', 'Admin']);
    });

    it('hands the search box to the parent and does not filter rows itself', () => {
      const onGlobalFilterChange = vi.fn();
      render(
        <DataTable
          columns={columns}
          data={data}
          manualFiltering
          globalFilter=""
          onGlobalFilterChange={onGlobalFilterChange}
        />,
      );

      fireEvent.change(screen.getByPlaceholderText('Search...'), { target: { value: 'Alice' } });

      expect(onGlobalFilterChange).toHaveBeenCalledWith('Alice');
      // Bob is still on screen: only the server can decide what matches.
      expect(screen.getByText('Bob')).toBeInTheDocument();
    });
  });

  /*
   * First and Last, which only the System Logs table asks for. Everything here is about the
   * pair being honest: present only when the table knows where the end is, and leaving the
   * reader's focus where they put it when the button they pressed becomes unavailable.
   */
  describe('first and last page buttons', () => {
    // Enough rows for three pages at the default size, so the client-mode table can actually
    // move and the buttons can reach their own limits.
    const manyRows: RowData[] = Array.from({ length: 25 }, (_, i) => ({
      id: String(i + 1),
      name: `Row ${i + 1}`,
      role: 'Student',
    }));

    const firstButton = () => screen.getByRole('button', { name: 'First page' });
    const lastButton = () => screen.getByRole('button', { name: 'Last page' });

    it('are not there unless a table asks for them', () => {
      render(<DataTable columns={columns} data={manyRows} storageKey="page-jump-off" />);

      expect(screen.queryByRole('button', { name: 'First page' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Last page' })).toBeNull();
      // The arrows a table has always had are untouched.
      expect(screen.getByRole('button', { name: 'Next page' })).toBeInTheDocument();
    });

    it('jump to either end', () => {
      render(
        <DataTable
          columns={columns}
          data={manyRows}
          showFirstLastPage
          storageKey="page-jump-ends"
        />,
      );

      fireEvent.click(lastButton());
      expect(screen.getAllByText(/Page 3 of 3/).length).toBeGreaterThan(0);
      expect(screen.getByText('Row 21')).toBeInTheDocument();

      fireEvent.click(firstButton());
      expect(screen.getAllByText(/Page 1 of 3/).length).toBeGreaterThan(0);
      expect(screen.getByText('Row 1')).toBeInTheDocument();
    });

    /**
     * The reason these are `aria-disabled` and not `disabled`. Pressing Last is what makes
     * Last unavailable, and a natively disabled element cannot hold focus, so the browser
     * drops it to the body: a keyboard reader lands back at the top of the page after every
     * jump. This is the whole point of the PageButton wrapper.
     */
    it("keep the reader's focus after the jump that disables them", () => {
      render(
        <DataTable
          columns={columns}
          data={manyRows}
          showFirstLastPage
          storageKey="page-jump-focus"
        />,
      );

      const last = lastButton();
      last.focus();
      fireEvent.click(last);

      expect(lastButton()).toHaveAttribute('aria-disabled', 'true');
      expect(lastButton()).not.toBeDisabled();
      expect(document.activeElement).toBe(lastButton());
    });

    it('do nothing when there is nowhere further to go', () => {
      render(
        <DataTable
          columns={columns}
          data={manyRows}
          showFirstLastPage
          storageKey="page-jump-limits"
        />,
      );

      expect(firstButton()).toHaveAttribute('aria-disabled', 'true');
      fireEvent.click(firstButton());

      expect(screen.getAllByText(/Page 1 of 3/).length).toBeGreaterThan(0);
    });

    /**
     * A server table that has not stated a pageCount reports -1, and react-table clamps a
     * jump into that unknown range by landing on page 1. A Last button there would not fail
     * loudly, it would quietly go to the beginning while still calling itself Last.
     */
    it('stay away when the table cannot say where the end is', () => {
      render(
        <DataTable
          columns={columns}
          data={data}
          showFirstLastPage
          manualPagination
          pagination={{ pageIndex: 0, pageSize: 10 }}
          onPaginationChange={vi.fn()}
        />,
      );

      expect(screen.queryByRole('button', { name: 'Last page' })).toBeNull();
      // Both or neither: half a cluster reads as something broken.
      expect(screen.queryByRole('button', { name: 'First page' })).toBeNull();
      expect(screen.getByRole('button', { name: 'Next page' })).toBeInTheDocument();
    });

    it('tell a server table which page to go to', () => {
      const onPaginationChange = vi.fn();
      render(
        <DataTable
          columns={columns}
          data={data}
          showFirstLastPage
          manualPagination
          pageCount={40}
          rowCount={2000}
          pagination={{ pageIndex: 0, pageSize: 50 }}
          onPaginationChange={onPaginationChange}
        />,
      );

      fireEvent.click(lastButton());

      expect(onPaginationChange).toHaveBeenCalledWith({ pageIndex: 39, pageSize: 50 });
    });
  });
});
