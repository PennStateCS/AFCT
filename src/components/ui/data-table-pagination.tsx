'use client';

import React from 'react';
import type { Table as TanstackTable } from '@tanstack/react-table';
import { TableCell, TableRow, TableFooter } from '@/components/ui/table';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { PAGE_SIZE_OPTIONS } from '@/components/ui/data-table-shared';

/** Prev/next paging, an optional total, and a page-size select. Presentation only,
 *  so it can render inside the desktop table footer or below the mobile cards. */
export function PaginationControls<TData>({
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
export function DataTablePagination<TData>({
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
          <PaginationControls table={table} rowCount={rowCount} manualPagination={manualPagination} />
        </TableCell>
      </TableRow>
    </TableFooter>
  );
}
