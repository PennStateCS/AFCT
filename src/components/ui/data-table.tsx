'use client';

import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  useReactTable,
  VisibilityState,
  SortingState,
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
}

// Extend @tanstack/react-table types
declare module '@tanstack/react-table' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData, TValue> {
    priority?: number;
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
}

export function DataTable<TData, TValue>({
  columns,
  data,
  loading = false,
  storageKey = 'datatable-columns',
  onRowClick,
}: DataTableProps<TData, TValue>) {
  const [globalFilter, setGlobalFilter] = useState('');
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [sorting, setSorting] = useState<SortingState>([]);

  useEffect(() => {
    const saved = localStorage.getItem(storageKey);
    if (saved) {
      try {
        setColumnVisibility(JSON.parse(saved));
      } catch {
        console.warn('Invalid saved column state, ignoring.');
      }
    }
  }, [storageKey]);

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(columnVisibility));
  }, [columnVisibility, storageKey]);

  const table = useReactTable<TData>({
    data,
    columns,
    // Use a stable row id (if provided on the data object) so pagination
    // and internal row caching won't mix rows between pages. Defaults to
    // index-based ids which can cause cells to show stale values when
    // navigating pages.
    getRowId: (row: TData) => {
      const r = row as unknown as Record<string, unknown>;
      return String(r.id ?? r._id ?? '');
    },
    state: {
      globalFilter,
      columnVisibility,
      sorting,
    },
    onGlobalFilterChange: setGlobalFilter,
    onColumnVisibilityChange: setColumnVisibility,
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  const resetColumns = () => {
    setColumnVisibility({});
    localStorage.removeItem(storageKey);
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
          <Button variant="outline" onClick={exportToCSV} aria-label="Export table data to CSV">
            <FileDown className="h-4 w-4" aria-hidden="true" />
            Export to CSV
          </Button>

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
                    {col.id}
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
        <Table className="w-full" role="table">
          <TableHeader role="rowgroup">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow
                key={headerGroup.id}
                style={{
                  backgroundColor: 'var(--table-header)',
                  color: 'var(--table-header-foreground)',
                }}
              >
                {headerGroup.headers.map((header) => {
                  const sorted = header.column.getIsSorted();
                  const canSort = header.column.getCanSort();
                  const priority = (header.column.columnDef.meta as ColumnMeta)?.priority;

                  const handleSortClick = () => {
                    if (!canSort) return;

                    const currentSort = sorting.find((s) => s.id === header.column.id);

                    if (!currentSort) {
                      setSorting([{ id: header.column.id, desc: false }]);
                    } else if (!currentSort.desc) {
                      setSorting([{ id: header.column.id, desc: true }]);
                    } else {
                      setSorting([{ id: header.column.id, desc: false }]);
                    }
                  };

                  return (
                    <TableHead
                      key={header.id}
                      onClick={handleSortClick}
                      className={`${getResponsiveClass(priority)} ${
                        canSort
                          ? 'cursor-pointer whitespace-nowrap select-none'
                          : 'whitespace-nowrap'
                      } h-12 font-semibold`}
                    >
                      {header.isPlaceholder ? null : (
                        <div className="flex items-center">
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {canSort && (
                            <>
                              {sorted === 'asc' && <ArrowUp className="ml-1 h-3 w-3" />}
                              {sorted === 'desc' && <ArrowDown className="ml-1 h-3 w-3" />}
                              {!sorted && <ArrowUpDown className="ml-1 h-3 w-3 opacity-40" />}
                            </>
                          )}
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
              <TableRow>
                <TableCell colSpan={columns.length} className="py-10 text-center">
                  <div className="flex flex-col items-center justify-center gap-2 text-gray-500">
                    <Loader2 className="h-6 w-6 animate-spin" />
                    <span>Loading data, please wait...</span>
                  </div>
                </TableCell>
              </TableRow>
            ) : table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
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
                  {row.getVisibleCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      className={`whitespace-nowrap ${getResponsiveClass(cell.column.columnDef.meta?.priority)}`}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
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
              style={{
                backgroundColor: 'var(--table-background)',
                color: 'var(--table-header-foreground)',
              }}
            >
              <TableCell colSpan={columns.length}>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="bg-header-background flex items-center gap-2 font-normal text-foreground">
                    <span>
                      Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}
                      &nbsp;&nbsp;&nbsp;
                    </span>

                    <Select
                      value={String(table.getState().pagination.pageSize)}
                      onValueChange={(value) => table.setPageSize(Number(value))}
                    >
                      <SelectTrigger>
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

                  <div className="flex gap-2">
                    <Button
                      variant="default"
                      onClick={() => table.previousPage()}
                      disabled={!table.getCanPreviousPage()}
                    >
                      <ArrowLeft /> Previous
                    </Button>
                    <Button
                      variant="default"
                      onClick={() => table.nextPage()}
                      disabled={!table.getCanNextPage()}
                    >
                      Next <ArrowRight />
                    </Button>
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
