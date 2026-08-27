'use client';

import React from 'react';
import type { Table as TanstackTable } from '@tanstack/react-table';
import { TableCell, TableRow, TableFooter } from '@/components/ui/table';
import { ArrowLeft, ArrowLeftToLine, ArrowRight, ArrowRightToLine } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { PAGE_SIZE_OPTIONS, rowRangeLabel } from '@/components/ui/data-table-shared';

/**
 * One paging arrow.
 *
 * `aria-disabled` rather than the native `disabled`, because the button you just pressed is
 * often the one that becomes unavailable: pressing Last disables Last. A natively disabled
 * element cannot hold focus, so the browser drops it to the body and a keyboard reader ends up
 * back at the top of the page after every jump. This keeps focus where they put it and makes
 * the press do nothing instead.
 */
function PageButton({
  label,
  icon: Icon,
  onClick,
  unavailable,
}: {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  unavailable: boolean;
}) {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => {
        if (!unavailable) onClick();
      }}
      aria-disabled={unavailable || undefined}
      className="aria-disabled:pointer-events-none aria-disabled:opacity-50"
      aria-label={label}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
    </Button>
  );
}

/** Prev/next paging, an optional total, and a page-size select. Presentation only,
 *  so it can render inside the desktop table footer or below the mobile cards. */
export function PaginationControls<TData>({
  table,
  rowCount,
  manualPagination,
  showFirstLastPage = false,
}: {
  table: TanstackTable<TData>;
  rowCount?: number;
  manualPagination: boolean;
  /** Add First and Last buttons either side of the arrows. See DataTable's own prop. */
  showFirstLastPage?: boolean;
}) {
  const pageCount = table.getPageCount();
  const pageLabel = `Page ${table.getState().pagination.pageIndex + 1} of ${Math.max(1, pageCount)}`;

  /**
   * First and Last, but only when the table knows how many pages it has.
   *
   * A server table that has not stated a `pageCount` reports -1, and react-table then clamps
   * a jump to anywhere between the first page and MAX_SAFE_INTEGER. A Last button there does
   * not fail loudly, it quietly lands on page 1 while still calling itself Last, and a control
   * that lies about where it goes is worse than no control. They come and go as a pair: half a
   * cluster reads as something broken.
   */
  const edges = showFirstLastPage && pageCount >= 0;

  /**
   * Which rows these are, and how many there are altogether.
   *
   * Server mode is handed an authoritative count; client mode derives one, and says what a
   * search is hiding. In server mode without a rowCount there is nothing honest to show at
   * all: the core row model holds only the current page, so counting it would claim the whole
   * table is ten rows long.
   *
   * The rows on screen are counted rather than calculated from the page size, which is what
   * makes the last page read "Showing 2,201-2,206" instead of running past the end.
   */
  const { pageIndex, pageSize } = table.getState().pagination;
  const rowsOnPage = table.getRowModel().rows.length;
  const firstRow = rowsOnPage === 0 ? 0 : pageIndex * pageSize + 1;

  let totalLabel: string | null = null;
  if (typeof rowCount === 'number') {
    totalLabel = rowRangeLabel({ firstRow, rowsOnPage, total: rowCount });
  } else if (!manualPagination) {
    const filtered = table.getFilteredRowModel().rows.length;
    const total = table.getCoreRowModel().rows.length;
    totalLabel = rowRangeLabel({
      firstRow,
      rowsOnPage,
      total: filtered,
      ...(filtered === total ? {} : { filteredFrom: total }),
    });
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      {/* One live region for the whole footer. The page indicator and the row total used
          to each carry aria-live, so a single page change fired two separate
          announcements; this announces the combined state once. The visible spans below
          are left silent. */}
      <span className="sr-only" role="status">
        {totalLabel ? `${pageLabel}, ${totalLabel}` : pageLabel}
      </span>

      <div className="text-foreground flex items-center gap-1 font-normal">
        {edges ? (
          <PageButton
            label="First page"
            icon={ArrowLeftToLine}
            onClick={() => table.setPageIndex(0)}
            unavailable={!table.getCanPreviousPage()}
          />
        ) : null}
        <PageButton
          label="Previous page"
          icon={ArrowLeft}
          onClick={() => table.previousPage()}
          unavailable={!table.getCanPreviousPage()}
        />
        <span className="px-2 whitespace-nowrap">{pageLabel}</span>
        <PageButton
          label="Next page"
          icon={ArrowRight}
          onClick={() => table.nextPage()}
          unavailable={!table.getCanNextPage()}
        />
        {edges ? (
          <PageButton
            label="Last page"
            icon={ArrowRightToLine}
            onClick={() => table.setPageIndex(pageCount - 1)}
            unavailable={!table.getCanNextPage()}
          />
        ) : null}
      </div>

      <div className="text-foreground flex items-center gap-3 font-normal">
        {totalLabel ? (
          <span className="text-muted-foreground text-sm whitespace-nowrap">{totalLabel}</span>
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
  showFirstLastPage = false,
}: {
  table: TanstackTable<TData>;
  rowCount?: number;
  manualPagination: boolean;
  loading: boolean;
  colSpan: number;
  showFirstLastPage?: boolean;
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
            showFirstLastPage={showFirstLastPage}
          />
        </TableCell>
      </TableRow>
    </TableFooter>
  );
}
