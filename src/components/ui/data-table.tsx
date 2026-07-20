'use client';

import React from 'react';

import type {
  ColumnDef,
  ColumnFiltersState,
  VisibilityState,
  SortingState,
  PaginationState,
  OnChangeFn,
  FilterFn,
  Row,
  Table as TanstackTable,
  Column as TanstackColumn,
} from '@tanstack/react-table';
import {
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  useReactTable,
} from '@tanstack/react-table';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableFooter,
} from '@/components/ui/table';
import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { DataTableFilterPopover } from '@/components/ui/data-table-faceted-filter';
import {
  Columns3Cog,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  FileDown,
  Inbox,
  ArrowLeft,
  ArrowRight,
  X,
  Loader2,
} from 'lucide-react';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { usePersistentColumnVisibility } from '@/components/ui/use-persistent-column-visibility';
import { escapeCsvCell } from '@/lib/csv';

type ColumnAlign = 'left' | 'center' | 'right';

// Extend @tanstack/react-table's ColumnMeta so `columnDef.meta.priority` / `.align`
// are typed everywhere; this augmentation is the single source of truth (there is no
// separate local interface to keep in sync).
declare module '@tanstack/react-table' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData, TValue> {
    priority?: number;
    align?: ColumnAlign;
    /** Opt this column into a faceted value filter (multi-select of its values). */
    filterVariant?: 'multiselect';
    /** Label for the filter button / search scope / mobile card (defaults to the
     *  string header, else the column id). */
    filterLabel?: string;
    /** Fixed, friendly options for the value filter. Without it, the distinct
     *  values found in the data are used (good for plain string columns; set this
     *  for boolean/coded columns so the picker shows real labels). */
    filterOptions?: { label: string; value: string }[];
    /** Hide this column from the stacked mobile card view. */
    mobileHidden?: boolean;
  }
}

/**
 * Matches a row when the column's value is one of the selected values. An empty /
 * missing selection is a no-op (row passes). Values are compared as strings so
 * boolean and numeric columns work with the string option values the UI stores.
 */
const multiSelectFilter: FilterFn<unknown> = (row, columnId, filterValue) => {
  if (!Array.isArray(filterValue) || filterValue.length === 0) return true;
  return filterValue.includes(String(row.getValue(columnId)));
};

const PAGE_SIZE_OPTIONS = [5, 10, 20, 50, 75, 100];

/** Tailwind text-alignment class for a column's `align` meta. */
const alignTextClass = (align: ColumnAlign | undefined): string =>
  align === 'center' ? 'text-center' : align === 'right' ? 'text-right' : '';

/** Flexbox justification matching a column's `align` meta. */
const alignFlexClass = (align: ColumnAlign | undefined): string =>
  align === 'center' ? 'justify-center' : align === 'right' ? 'justify-end' : '';

/** aria-sort value for a header cell given whether it's sortable and its sort state. */
const ariaSort = (
  canSort: boolean,
  sorted: false | 'asc' | 'desc',
): 'ascending' | 'descending' | 'none' | undefined => {
  if (!canSort) return undefined;
  if (sorted === 'asc') return 'ascending';
  if (sorted === 'desc') return 'descending';
  return 'none';
};

/** The table's toolbar: scoped global search, a combined value-filter popover for the
 *  opted-in columns, caller action buttons, CSV export, and column visibility. */
function DataTableToolbar<TData>({
  table,
  globalFilter,
  setGlobalFilter,
  searchScope,
  setSearchScope,
  scopeOptions,
  filterableColumns,
  activeFilterCount,
  actionButtons,
  showExportButton,
  onExport,
  onResetColumns,
  getColumnLabel,
}: {
  table: TanstackTable<TData>;
  globalFilter: string;
  setGlobalFilter: (value: string) => void;
  searchScope: string;
  setSearchScope: (value: string) => void;
  scopeOptions: { value: string; label: string }[];
  filterableColumns: TanstackColumn<TData, unknown>[];
  activeFilterCount: number;
  actionButtons?: React.ReactNode;
  showExportButton: boolean;
  onExport: () => void;
  onResetColumns: () => void;
  getColumnLabel: (column: TanstackColumn<TData, unknown>) => string;
}) {
  const hasScope = scopeOptions.length > 0;
  // Placeholder reflects the scope: generic on the default (first) option, the field
  // name when scoped to a specific one.
  const isDefaultScope = !hasScope || searchScope === scopeOptions[0]?.value;
  const scopedLabel = scopeOptions.find((o) => o.value === searchScope)?.label;
  const searchPlaceholder =
    !isDefaultScope && scopedLabel ? `Search ${scopedLabel.toLowerCase()}...` : 'Search...';

  // Unique id so multiple DataTables on one page don't collide on the search label.
  const searchId = React.useId();

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <label htmlFor={searchId} className="sr-only">
        Search table data
      </label>

      <div className="flex w-full sm:max-w-md lg:max-w-lg xl:max-w-xl">
        {hasScope && (
          <Select value={searchScope} onValueChange={setSearchScope}>
            <SelectTrigger
              className="w-[140px] shrink-0 rounded-r-none border-r-0"
              aria-label="Search scope"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {scopeOptions.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <div className="relative min-w-0 flex-1">
          <Input
            id={searchId}
            placeholder={searchPlaceholder}
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            className={`pr-8 ${hasScope ? 'rounded-l-none' : ''}`}
          />
          {globalFilter && (
            <button
              type="button"
              onClick={() => setGlobalFilter('')}
              className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {filterableColumns.length > 0 && (
          <DataTableFilterPopover
            activeCount={activeFilterCount}
            onClearAll={() => table.resetColumnFilters()}
            columns={filterableColumns.map((col) => ({
              column: col,
              label: getColumnLabel(col),
              options: col.columnDef.meta?.filterOptions,
            }))}
          />
        )}

        {actionButtons}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" aria-label="Columns">
              <Columns3Cog className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">Columns</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {table
              .getAllLeafColumns()
              .filter((col) => col.getCanHide())
              .map((col) => (
                <DropdownMenuCheckboxItem
                  key={col.id}
                  className="capitalize"
                  checked={col.getIsVisible()}
                  onCheckedChange={(value) => col.toggleVisibility(!!value)}
                >
                  {getColumnLabel(col)}
                </DropdownMenuCheckboxItem>
              ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onResetColumns} className="text-red-600 hover:text-red-700">
              Reset Columns
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {showExportButton ? (
          <Button variant="outline" onClick={onExport} aria-label="Export table data to CSV">
            <FileDown className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">Export</span>
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** Prev/next paging, an optional total, and a page-size select. Presentation only,
 *  so it can render inside the desktop table footer or below the mobile cards. */
function PaginationControls<TData>({
  table,
  rowCount,
  manualPagination,
}: {
  table: TanstackTable<TData>;
  rowCount?: number;
  manualPagination: boolean;
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="text-foreground flex items-center gap-1 font-normal">
        <Button
          variant="outline"
          size="sm"
          onClick={() => table.previousPage()}
          disabled={!table.getCanPreviousPage()}
          aria-label="Previous page"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        </Button>
        <span className="px-2 whitespace-nowrap" aria-live="polite">
          Page {table.getState().pagination.pageIndex + 1} of {Math.max(1, table.getPageCount())}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => table.nextPage()}
          disabled={!table.getCanNextPage()}
          aria-label="Next page"
        >
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>

      <div className="text-foreground flex items-center gap-3 font-normal">
        {typeof rowCount === 'number' ? (
          <span className="text-muted-foreground text-sm whitespace-nowrap" aria-live="polite">
            {rowCount} total
          </span>
        ) : null}
        {/* Client-side filtering has no visible total; announce the filtered count
            to screen readers so search results aren't silent. */}
        {!manualPagination ? (
          <span className="sr-only" aria-live="polite">
            {table.getFilteredRowModel().rows.length} results
          </span>
        ) : null}
        <Select
          value={String(table.getState().pagination.pageSize)}
          onValueChange={(value) => table.setPageSize(Number(value))}
        >
          <SelectTrigger aria-label="Rows per page">
            <SelectValue placeholder="Select rows per page" />
          </SelectTrigger>
          <SelectContent>
            {PAGE_SIZE_OPTIONS.map((size) => (
              <SelectItem key={size} value={String(size)}>
                {size} / page
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

/** The desktop footer row wrapper around PaginationControls. */
function DataTablePagination<TData>({
  table,
  rowCount,
  manualPagination,
  loading,
  colSpan,
}: {
  table: TanstackTable<TData>;
  rowCount?: number;
  manualPagination: boolean;
  loading: boolean;
  colSpan: number;
}) {
  return (
    <TableFooter>
      <TableRow
        className={loading ? 'hover:bg-transparent' : undefined}
        style={{
          backgroundColor: 'var(--table-background)',
          color: 'var(--table-header-foreground)',
        }}
      >
        <TableCell colSpan={colSpan}>
          <PaginationControls
            table={table}
            rowCount={rowCount}
            manualPagination={manualPagination}
          />
        </TableCell>
      </TableRow>
    </TableFooter>
  );
}

/**
 * Stacked card view for narrow screens: each row becomes a card of label/value
 * pairs (labels are the column headers, values the same cell renderers as the
 * table), with the actions column pinned to the card footer. Avoids the sideways
 * scroll a wide table forces on a phone.
 */
function DataTableCards<TData>({
  table,
  loading,
  tableLabel,
  getColumnLabel,
}: {
  table: TanstackTable<TData>;
  loading: boolean;
  tableLabel: string;
  getColumnLabel: (column: TanstackColumn<TData, unknown>) => string;
}) {
  if (loading) {
    return (
      <div
        className="flex flex-col items-center justify-center gap-2 rounded-md border py-10 text-gray-500"
        role="status"
        aria-live="polite"
      >
        <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
        <span>Loading data, please wait...</span>
      </div>
    );
  }

  const rows = table.getRowModel().rows;
  if (!rows.length) {
    return (
      <div className="text-muted-foreground flex flex-col items-center rounded-md border py-8">
        <Inbox className="mb-2 h-10 w-10 text-gray-400" aria-hidden="true" />
        <p className="font-medium">No data found</p>
        <p className="text-sm">Try adjusting filters or adding new entries.</p>
      </div>
    );
  }

  return (
    <ul className="space-y-3" aria-label={tableLabel} aria-busy={loading}>
      {rows.map((row: Row<TData>) => {
        const cells = row.getVisibleCells();
        const actionsCell = cells.find((c) => c.column.id === 'actions');
        const bodyCells = cells.filter(
          (c) => c.column.id !== 'actions' && !c.column.columnDef.meta?.mobileHidden,
        );
        return (
          <li
            key={row.id}
            className="rounded-md border bg-[var(--table-background)] p-4"
          >
            <dl className="grid gap-2">
              {bodyCells.map((cell) => (
                <div
                  key={cell.id}
                  className="flex items-start justify-between gap-4 text-sm"
                >
                  <dt className="text-muted-foreground font-medium">
                    {getColumnLabel(cell.column)}
                  </dt>
                  <dd className="min-w-0 text-right break-words">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </dd>
                </div>
              ))}
            </dl>
            {actionsCell ? (
              <div className="mt-3 flex justify-end border-t pt-3">
                {flexRender(actionsCell.column.columnDef.cell, actionsCell.getContext())}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Below 768px, present rows as stacked cards instead of a horizontally scrolling
 * table. Guards against jsdom / SSR where matchMedia is absent: returns false
 * until mounted, so the server and tests render the desktop table.
 */
function useStackedView() {
  const [stacked, setStacked] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia('(max-width: 767px)');
    const update = () => setStacked(mql.matches);
    update();
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, []);
  return stacked;
}

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  loading?: boolean;
  storageKey?: string;
  tableLabel?: string;
  showExportButton?: boolean;
  actionButtons?: React.ReactNode;
  defaultColumnVisibility?: VisibilityState;

  // ---- Server-side ("manual") mode: all optional; omit for client-side. ----
  // When a controlled value + handler is provided, the table hands that concern
  // (pagination / sorting / filtering) to the parent instead of computing it
  // over `data`. Existing callers pass none of these and keep client behavior.
  manualPagination?: boolean;
  /** Total page count, required when manualPagination is on. */
  pageCount?: number;
  /** Total row count across all pages (for the footer summary). */
  rowCount?: number;
  pagination?: PaginationState;
  onPaginationChange?: OnChangeFn<PaginationState>;

  manualSorting?: boolean;
  sorting?: SortingState;
  onSortingChange?: OnChangeFn<SortingState>;
  /** Initial client-side sort (uncontrolled). Ignored when `sorting` is controlled. */
  defaultSorting?: SortingState;

  manualFiltering?: boolean;
  globalFilter?: string;
  onGlobalFilterChange?: (value: string) => void;
  /**
   * Server-side search scope. Provide explicit options (e.g. `[{value:'all',label:'All
   * columns'}, {value:'action',label:'Action'}]`) plus a controlled value/handler to get
   * the same segmented scope dropdown the client tables derive from their columns. The
   * first option is the default; the parent decides what scoping means server-side.
   */
  searchScopeOptions?: { value: string; label: string }[];
  searchScope?: string;
  onSearchScopeChange?: (value: string) => void;
}

export function DataTable<TData, TValue>({
  columns,
  data,
  loading = false,
  storageKey = 'datatable-columns',
  tableLabel = 'Data table',
  showExportButton = true,
  actionButtons,
  defaultColumnVisibility = {},
  manualPagination = false,
  pageCount,
  rowCount,
  pagination: paginationProp,
  onPaginationChange,
  manualSorting = false,
  sorting: sortingProp,
  onSortingChange,
  defaultSorting = [],
  manualFiltering = false,
  globalFilter: globalFilterProp,
  onGlobalFilterChange,
  searchScopeOptions,
  searchScope: searchScopeProp,
  onSearchScopeChange,
}: DataTableProps<TData, TValue>) {
  const { columnVisibility, setColumnVisibility, resetColumns } = usePersistentColumnVisibility(
    storageKey,
    defaultColumnVisibility,
  );

  // Each of filtering / sorting / pagination is controlled by the parent when a
  // value is supplied, otherwise held internally (the original client behavior).
  const [internalGlobalFilter, setInternalGlobalFilter] = useState('');
  const globalFilter = globalFilterProp ?? internalGlobalFilter;
  const setGlobalFilter = onGlobalFilterChange ?? setInternalGlobalFilter;

  // Client-side value filters (faceted). Server mode owns its own filtering.
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);

  // Search scope: 'all' searches every column, otherwise only the named column
  // (client mode). In server mode the parent controls the scope value + meaning.
  // Read through a ref inside the (stable) global filter fn so changing scope
  // doesn't need a new function identity / table rebuild.
  const [internalSearchScope, setInternalSearchScope] = useState('all');
  const searchScope = searchScopeProp ?? internalSearchScope;
  const setSearchScope = onSearchScopeChange ?? setInternalSearchScope;
  const searchScopeRef = useRef(searchScope);
  searchScopeRef.current = searchScope;
  const scopedGlobalFilter = useCallback<FilterFn<TData>>((row, columnId, value) => {
    const scope = searchScopeRef.current;
    if (scope !== 'all' && columnId !== scope) return false;
    return String(row.getValue(columnId) ?? '')
      .toLowerCase()
      .includes(String(value).toLowerCase());
  }, []);

  // Attach the multiselect filter fn to any column that opts into value filtering,
  // so callers only need to set `meta.filterVariant` (declarative, no filterFn wiring).
  const tableColumns = useMemo(
    () =>
      columns.map((col) =>
        col.meta?.filterVariant
          ? { ...col, enableColumnFilter: true, filterFn: multiSelectFilter as FilterFn<TData> }
          : col,
      ),
    [columns],
  );

  const [internalSorting, setInternalSorting] = useState<SortingState>(defaultSorting);
  const sorting = sortingProp ?? internalSorting;

  const [internalPagination, setInternalPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 10,
  });
  const pagination = paginationProp ?? internalPagination;

  // Normalize react-table's value-or-updater callbacks down to a plain value so
  // both internal setState and the parent's (value) => void handlers work.
  const handleSortingChange: OnChangeFn<SortingState> = (updater) => {
    const next = typeof updater === 'function' ? updater(sorting) : updater;
    (onSortingChange ?? setInternalSorting)(next);
  };
  const handlePaginationChange: OnChangeFn<PaginationState> = (updater) => {
    const next = typeof updater === 'function' ? updater(pagination) : updater;
    (onPaginationChange ?? setInternalPagination)(next);
  };
  const handleGlobalFilterChange: OnChangeFn<string> = (updater) => {
    const next = typeof updater === 'function' ? updater(globalFilter) : updater;
    setGlobalFilter(next);
  };

  const table = useReactTable<TData>({
    data,
    columns: tableColumns,
    // Use a stable row id (if provided on the data object) so pagination
    // and internal row caching won't mix rows between pages. Defaults to
    // index-based ids which can cause cells to show stale values when
    // navigating pages.
    // provide a stable id for each row; fall back to the index if no
    // identifier property is available. Previously we returned an empty
    // string when `id`/`_id` was missing which caused duplicate-key
    // warnings (see GradeBreakdownDialog). Using the index guarantees
    // uniqueness across the current page and avoids rendering errors.
    getRowId: (row: TData, index: number) => {
      const r = row as unknown as Record<string, unknown>;
      // prefer known id properties, otherwise use the row index
      return String(r.id ?? r._id ?? index);
    },
    state: {
      globalFilter,
      columnVisibility,
      sorting,
      pagination,
      columnFilters,
    },
    manualPagination,
    manualSorting,
    manualFiltering,
    pageCount: manualPagination ? (pageCount ?? -1) : undefined,
    rowCount: manualPagination ? rowCount : undefined,
    globalFilterFn: scopedGlobalFilter,
    onGlobalFilterChange: handleGlobalFilterChange,
    onColumnVisibilityChange: setColumnVisibility,
    onColumnFiltersChange: setColumnFilters,
    onSortingChange: handleSortingChange,
    onPaginationChange: handlePaginationChange,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: manualSorting ? undefined : getSortedRowModel(),
    getFilteredRowModel: manualFiltering ? undefined : getFilteredRowModel(),
    getPaginationRowModel: manualPagination ? undefined : getPaginationRowModel(),
    // Faceted models power the value-filter option lists + counts (client mode only).
    getFacetedRowModel: manualFiltering ? undefined : getFacetedRowModel(),
    getFacetedUniqueValues: manualFiltering ? undefined : getFacetedUniqueValues(),
  });

  const exportToCSV = () => {
    const rows = table.getRowModel().rows;
    if (!rows.length) return;

    const visibleColumns = table.getAllLeafColumns().filter((col) => col.id !== 'actions');

    // Every cell goes through escapeCsvCell: it quotes (so embedded commas/newlines are
    // safe) AND neutralizes leading =, +, -, @, tab and CR, which a spreadsheet would
    // otherwise execute as a formula. Table values include user-controlled text such as
    // student names and course titles, so quoting alone was not enough. Non-string values
    // were also previously emitted raw, which broke the row on anything containing a comma.
    const headers = visibleColumns.map((col) => escapeCsvCell(col.id));
    const csvRows = [headers.join(',')];

    rows.forEach((row) => {
      const values = row
        .getVisibleCells()
        .filter((cell) => visibleColumns.includes(cell.column))
        .map((cell) => escapeCsvCell(cell.getValue()));
      csvRows.push(values.join(','));
    });

    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'table_export.csv');
    link.click();
    URL.revokeObjectURL(url);
  };

  const getResponsiveClass = (priority: number | undefined) => {
    if (priority === 1) return '';
    if (priority === 2) return 'hidden sm:table-cell';
    if (priority === 3) return 'hidden md:table-cell';
    if (priority === 4) return 'hidden lg:table-cell';
    return '';
  };

  const getColumnFilterLabel = (column: ReturnType<typeof table.getAllLeafColumns>[number]) => {
    const label = column.columnDef.meta?.filterLabel;
    if (label && label.trim().length > 0) return label;
    const header = column.columnDef.header;
    if (typeof header === 'string' && header.trim().length > 0) {
      return header;
    }
    return column.id;
  };

  const getSortableColumnLabel = (column: ReturnType<typeof table.getAllLeafColumns>[number]) => {
    return getColumnFilterLabel(column).toLowerCase();
  };

  // Value-filter and search-scope only make sense client-side (server mode owns
  // filtering and doesn't have every value on hand).
  const leafColumns = table.getAllLeafColumns();
  const filterableColumns = manualFiltering
    ? []
    : leafColumns.filter((col) => col.columnDef.meta?.filterVariant);
  const searchableColumns = manualFiltering
    ? []
    : leafColumns.filter(
        (col) =>
          col.getCanGlobalFilter() &&
          col.id !== 'actions' &&
          typeof col.columnDef.header === 'string',
      );
  // Scope dropdown options: explicit (server mode) or derived from the columns (client),
  // with an "All columns" default prepended in the derived case.
  const scopeOptions =
    searchScopeOptions ??
    (searchableColumns.length > 0
      ? [
          { value: 'all', label: 'All columns' },
          ...searchableColumns.map((col) => ({ value: col.id, label: getColumnFilterLabel(col) })),
        ]
      : []);
  const activeFilterCount = columnFilters.length;

  const stacked = useStackedView();

  return (
    <div className="space-y-4">
      <DataTableToolbar
        table={table}
        globalFilter={globalFilter}
        setGlobalFilter={setGlobalFilter}
        searchScope={searchScope}
        setSearchScope={setSearchScope}
        scopeOptions={scopeOptions}
        filterableColumns={filterableColumns}
        activeFilterCount={activeFilterCount}
        actionButtons={actionButtons}
        showExportButton={showExportButton}
        onExport={exportToCSV}
        onResetColumns={resetColumns}
        getColumnLabel={getColumnFilterLabel}
      />

      {stacked ? (
        <div className="space-y-3">
          <DataTableCards
            table={table}
            loading={loading}
            tableLabel={tableLabel}
            getColumnLabel={getColumnFilterLabel}
          />
          <div className="rounded-md border p-3">
            <PaginationControls
              table={table}
              rowCount={rowCount}
              manualPagination={manualPagination}
            />
          </div>
        </div>
      ) : (
        /* Single scroll container: the Table primitive already wraps the table in an
           overflow-x-auto div, so this wrapper only frames it (a second overflow-x-auto
           here produced a doubled/flaky horizontal scrollbar). overflow-hidden keeps the
           rounded corners clipping the scrolling content. */
        <div className="overflow-hidden rounded-md border">
        <Table className="w-full" role="table" aria-label={tableLabel} aria-busy={loading}>
          <TableHeader role="rowgroup">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow
                key={headerGroup.id}
                className={loading ? 'hover:bg-transparent' : undefined}
                style={{
                  backgroundColor: 'var(--table-header)',
                  color: 'var(--table-header-foreground)',
                }}
              >
                {headerGroup.headers.map((header) => {
                  const sorted = header.column.getIsSorted();
                  const canSort = header.column.getCanSort();
                  const priority = header.column.columnDef.meta?.priority;

                  const handleSortClick = () => {
                    if (!canSort) return;

                    const currentSort = sorting.find((s) => s.id === header.column.id);

                    if (!currentSort) {
                      handleSortingChange([{ id: header.column.id, desc: false }]);
                    } else if (!currentSort.desc) {
                      handleSortingChange([{ id: header.column.id, desc: true }]);
                    } else {
                      handleSortingChange([{ id: header.column.id, desc: false }]);
                    }
                  };

                  const align = header.column.columnDef.meta?.align;
                  const flexClass = alignFlexClass(align);

                  return (
                    <TableHead
                      key={header.id}
                      aria-sort={ariaSort(canSort, sorted)}
                      className={`${getResponsiveClass(priority)} h-12 font-semibold whitespace-nowrap ${alignTextClass(align)}`}
                    >
                      {header.isPlaceholder ? null : canSort ? (
                        <button
                          type="button"
                          onClick={handleSortClick}
                          className={`flex w-full cursor-pointer items-center select-none ${flexClass || 'text-left'}`}
                          aria-label={`Sort by ${getSortableColumnLabel(header.column)}`}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {sorted === 'asc' && <ArrowUp className="ml-1 h-3 w-3" />}
                          {sorted === 'desc' && <ArrowDown className="ml-1 h-3 w-3" />}
                          {!sorted && <ArrowUpDown className="ml-1 h-3 w-3 opacity-40" />}
                        </button>
                      ) : (
                        <div className={`flex items-center ${flexClass}`}>
                          {flexRender(header.column.columnDef.header, header.getContext())}
                        </div>
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>

          <TableBody>
            {loading ? (
              <TableRow className="pointer-events-none hover:bg-transparent">
                <TableCell colSpan={columns.length} className="py-10 text-center">
                  <div
                    className="flex flex-col items-center justify-center gap-2 text-gray-500"
                    role="status"
                    aria-live="polite"
                  >
                    <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
                    <span>Loading data, please wait...</span>
                  </div>
                </TableCell>
              </TableRow>
            ) : table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  className="bg-[var(--table-background)] hover:bg-[var(--table-highlight)]"
                >
                  {/* No forced nowrap on cells: on narrow screens long values
                      (emails, titles) wrap inside their cell instead of
                      stretching the whole table into a sideways scroll. */}
                  {row.getVisibleCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      className={`${getResponsiveClass(cell.column.columnDef.meta?.priority)} ${alignTextClass(cell.column.columnDef.meta?.align)}`}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={columns.length} className="py-8 text-center">
                  <div className="text-muted-foreground flex flex-col items-center">
                    <Inbox className="mb-2 h-10 w-10 text-gray-400" aria-hidden="true" />
                    <p className="font-medium">No data found</p>
                    <p className="text-sm">Try adjusting filters or adding new entries.</p>
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>

          <DataTablePagination
            table={table}
            rowCount={rowCount}
            manualPagination={manualPagination}
            loading={loading}
            colSpan={columns.length}
          />
        </Table>
        </div>
      )}
    </div>
  );
}
