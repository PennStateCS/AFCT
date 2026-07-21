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
} from '@/components/ui/table';
import { useState, useMemo, useRef, useCallback } from 'react';
import { ArrowUp, ArrowDown, ArrowUpDown, Inbox, Loader2 } from 'lucide-react';
import { usePersistentColumnVisibility } from '@/components/ui/use-persistent-column-visibility';
import { escapeCsvCell } from '@/lib/csv';
import {
  multiSelectFilter,
  alignTextClass,
  alignFlexClass,
  ariaSort,
  responsiveClass,
  columnLabel,
} from '@/components/ui/data-table-shared';
import { DataTableToolbar } from '@/components/ui/data-table-toolbar';
import {
  PaginationControls,
  DataTablePagination,
} from '@/components/ui/data-table-pagination';
import { DataTableCards, useStackedView } from '@/components/ui/data-table-cards';

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
          ...searchableColumns.map((col) => ({ value: col.id, label: columnLabel(col) })),
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
        getColumnLabel={columnLabel}
      />

      {stacked ? (
        <div className="space-y-3">
          <DataTableCards
            table={table}
            loading={loading}
            tableLabel={tableLabel}
            getColumnLabel={columnLabel}
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
                        className={`${responsiveClass(priority)} h-12 font-semibold whitespace-nowrap ${alignTextClass(align)}`}
                      >
                        {header.isPlaceholder ? null : canSort ? (
                          <button
                            type="button"
                            onClick={handleSortClick}
                            className={`flex w-full cursor-pointer items-center select-none ${flexClass || 'text-left'}`}
                            aria-label={`Sort by ${columnLabel(header.column).toLowerCase()}`}
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
                        className={`${responsiveClass(cell.column.columnDef.meta?.priority)} ${alignTextClass(cell.column.columnDef.meta?.align)}`}
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
