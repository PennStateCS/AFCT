'use client';

import React from 'react';

import type {
  ColumnDef,
  VisibilityState,
  SortingState,
  PaginationState,
  OnChangeFn,
} from '@tanstack/react-table';
import {
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  getFilteredRowModel,
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
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

// Define meta type for table columns
interface ColumnMeta {
  priority?: number;
  align?: 'left' | 'center' | 'right';
}

// Extend @tanstack/react-table types
declare module '@tanstack/react-table' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData, TValue> {
    priority?: number;
    align?: 'left' | 'center' | 'right';
  }
}

import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { useEffect, useState } from 'react';
import {
  Filter,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  FileDown,
  Inbox,
  ArrowLeft,
  ArrowRight,
  X,
  Loader2, // import spinner icon
} from 'lucide-react';

import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  loading?: boolean;
  storageKey?: string;
  onRowClick?: (row: { original: TData }) => void;
  tableLabel?: string;
  showExportButton?: boolean;
  actionButtons?: React.ReactNode;
  defaultColumnVisibility?: VisibilityState;

  // ---- Server-side ("manual") mode — all optional; omit for client-side. ----
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

  manualFiltering?: boolean;
  globalFilter?: string;
  onGlobalFilterChange?: (value: string) => void;
}

export function DataTable<TData, TValue>({
  columns,
  data,
  loading = false,
  storageKey = 'datatable-columns',
  onRowClick,
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
  manualFiltering = false,
  globalFilter: globalFilterProp,
  onGlobalFilterChange,
}: DataTableProps<TData, TValue>) {
  const [columnVisibility, setColumnVisibility] =
    useState<VisibilityState>(defaultColumnVisibility);

  // Each of filtering / sorting / pagination is controlled by the parent when a
  // value is supplied, otherwise held internally (the original client behavior).
  const [internalGlobalFilter, setInternalGlobalFilter] = useState('');
  const globalFilter = globalFilterProp ?? internalGlobalFilter;
  const setGlobalFilter = onGlobalFilterChange ?? setInternalGlobalFilter;

  const [internalSorting, setInternalSorting] = useState<SortingState>([]);
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

  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        try {
          setColumnVisibility({ ...defaultColumnVisibility, ...JSON.parse(saved) });
        } catch {
          console.warn('Invalid saved column state, ignoring.');
        }
      }
    } catch {
      // localStorage may not be available in all environments
    }
    // defaultColumnVisibility is only the hydration baseline; re-running when its
    // object identity changes on a parent re-render would clobber user column choices.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(columnVisibility));
    } catch {
      // localStorage may not be available in all environments
    }
  }, [columnVisibility, storageKey]);

  const table = useReactTable<TData>({
    data,
    columns,
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
    },
    manualPagination,
    manualSorting,
    manualFiltering,
    pageCount: manualPagination ? (pageCount ?? -1) : undefined,
    rowCount: manualPagination ? rowCount : undefined,
    onGlobalFilterChange: handleGlobalFilterChange,
    onColumnVisibilityChange: setColumnVisibility,
    onSortingChange: handleSortingChange,
    onPaginationChange: handlePaginationChange,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: manualSorting ? undefined : getSortedRowModel(),
    getFilteredRowModel: manualFiltering ? undefined : getFilteredRowModel(),
    getPaginationRowModel: manualPagination ? undefined : getPaginationRowModel(),
  });

  const resetColumns = () => {
    setColumnVisibility(defaultColumnVisibility);
    try {
      localStorage.removeItem(storageKey);
    } catch {
      // localStorage may not be available in all environments
    }
  };

  const exportToCSV = () => {
    const rows = table.getRowModel().rows;
    if (!rows.length) return;

    const visibleColumns = table.getAllLeafColumns().filter((col) => col.id !== 'actions');

    const headers = visibleColumns.map((col) => col.id);
    const csvRows = [headers.join(',')];

    rows.forEach((row) => {
      const values = row
        .getVisibleCells()
        .filter((cell) => visibleColumns.includes(cell.column))
        .map((cell) => {
          const val = cell.getValue();
          if (typeof val === 'string') {
            return `"${val.replace(/"/g, '""')}"`;
          }
          return val ?? '';
        });
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
    const header = column.columnDef.header;
    if (typeof header === 'string' && header.trim().length > 0) {
      return header;
    }
    return column.id;
  };

  const getSortableColumnLabel = (column: ReturnType<typeof table.getAllLeafColumns>[number]) => {
    return getColumnFilterLabel(column).toLowerCase();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <label htmlFor="table-search" className="sr-only">
          Search table data
        </label>

        <div className="relative w-full sm:max-w-sm">
          <Input
            id="table-search"
            placeholder="Search..."
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            className="pr-8"
          />
          {globalFilter && (
            <button
              type="button"
              onClick={() => setGlobalFilter('')}
              className="absolute top-1/2 right-2 -translate-y-1/2 text-gray-400 hover:text-gray-700"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {actionButtons}

          {showExportButton ? (
            <Button variant="outline" onClick={exportToCSV} aria-label="Export table data to CSV">
              <FileDown className="h-4 w-4" aria-hidden="true" />
              Export to CSV
            </Button>
          ) : null}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">
                <Filter className="h-4 w-4" aria-hidden="true" />
                Filter Columns
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
                    {getColumnFilterLabel(col)}
                  </DropdownMenuCheckboxItem>
                ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={resetColumns} className="text-red-600 hover:text-red-700">
                Reset Columns
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border">
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
                {headerGroup.headers.map((header, hIndex) => {
                  const sorted = header.column.getIsSorted();
                  const canSort = header.column.getCanSort();
                  const priority = (header.column.columnDef.meta as ColumnMeta)?.priority;

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

                  const align = (header.column.columnDef.meta as ColumnMeta)?.align;
                  const alignHeadClass =
                    align === 'center' ? 'text-center' : align === 'right' ? 'text-right' : '';
                  const alignFlexClass =
                    align === 'center' ? 'justify-center' : align === 'right' ? 'justify-end' : '';

                  return (
                    <TableHead
                      key={`h-${hIndex}`}
                      aria-sort={
                        canSort
                          ? sorted === 'asc'
                            ? 'ascending'
                            : sorted === 'desc'
                              ? 'descending'
                              : 'none'
                          : undefined
                      }
                      className={`${getResponsiveClass(priority)} h-12 font-semibold whitespace-nowrap ${alignHeadClass}`}
                    >
                      {header.isPlaceholder ? null : canSort ? (
                        <button
                          type="button"
                          onClick={handleSortClick}
                          className={`flex w-full cursor-pointer items-center select-none ${alignFlexClass || 'text-left'}`}
                          aria-label={`Sort by ${getSortableColumnLabel(header.column)}`}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {sorted === 'asc' && <ArrowUp className="ml-1 h-3 w-3" />}
                          {sorted === 'desc' && <ArrowDown className="ml-1 h-3 w-3" />}
                          {!sorted && <ArrowUpDown className="ml-1 h-3 w-3 opacity-40" />}
                        </button>
                      ) : (
                        <div className={`flex items-center ${alignFlexClass}`}>
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
              table.getRowModel().rows.map((row, rIndex) => (
                <TableRow
                  key={`r-${rIndex}`}
                  tabIndex={onRowClick ? 0 : undefined}
                  onKeyDown={(e) => {
                    if (onRowClick && (e.key === 'Enter' || e.key === ' ')) {
                      onRowClick(row);
                    }
                  }}
                  onClick={() => onRowClick?.(row)}
                  className={`bg-[var(--table-background)] ${
                    onRowClick
                      ? 'cursor-pointer hover:bg-[var(--table-highlight)] focus:bg-[var(--table-highlight)] focus:outline-none'
                      : 'hover:bg-[var(--table-highlight)]'
                  }`}
                >
                  {row.getVisibleCells().map((cell, cIndex) => {
                    const cellAlign = cell.column.columnDef.meta?.align;
                    const cellAlignClass =
                      cellAlign === 'center'
                        ? 'text-center'
                        : cellAlign === 'right'
                          ? 'text-right'
                          : '';
                    return (
                      <TableCell
                        key={`c-${cIndex}`}
                        className={`whitespace-nowrap ${getResponsiveClass(cell.column.columnDef.meta?.priority)} ${cellAlignClass}`}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))
            ) : (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={columns.length} className="py-8 text-center">
                  <div className="text-muted-foreground flex flex-col items-center">
                    <Inbox className="mb-2 h-10 w-10 text-gray-400" />
                    <p className="font-medium">No data found</p>
                    <p className="text-sm">Try adjusting filters or adding new entries.</p>
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>

          <TableFooter>
            <TableRow
              className={loading ? 'hover:bg-transparent' : undefined}
              style={{
                backgroundColor: 'var(--table-background)',
                color: 'var(--table-header-foreground)',
              }}
            >
              <TableCell colSpan={columns.length}>
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
                    <span className="px-2 whitespace-nowrap">
                      Page {table.getState().pagination.pageIndex + 1} of{' '}
                      {Math.max(1, table.getPageCount())}
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
                      <span className="text-muted-foreground text-sm whitespace-nowrap">
                        {rowCount} total
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
                        {[5, 10, 20, 50, 75, 100].map((size) => (
                          <SelectItem key={size} value={String(size)}>
                            Show {size} Records
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </div>
    </div>
  );
}
