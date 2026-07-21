'use client';

import React from 'react';
import type { Table as TanstackTable, Column as TanstackColumn } from '@tanstack/react-table';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { DataTableFilterPopover } from '@/components/ui/data-table-faceted-filter';
import { Columns3Cog, FileDown, X } from 'lucide-react';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

/** The table's toolbar: scoped global search, a combined value-filter popover for the
 *  opted-in columns, caller action buttons, CSV export, and column visibility. */
export function DataTableToolbar<TData>({
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
