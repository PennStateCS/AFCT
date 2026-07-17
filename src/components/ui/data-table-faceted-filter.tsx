'use client';

import * as React from 'react';
import type { Column } from '@tanstack/react-table';
import { ListFilter } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

export interface FacetOption {
  label: string;
  value: string;
}

export interface FilterableColumn<TData> {
  column: Column<TData, unknown>;
  label: string;
  /** Fixed, friendly options; falls back to the distinct values in the data. */
  options?: FacetOption[];
}

/**
 * One column's value filter, rendered as a labelled block of checkboxes inside the
 * shared filter popover. Selecting several values ORs them within the column; the
 * selection is stored as a string[] on the column filter and matched by the table's
 * multiselect filterFn. Values are compared as strings, so boolean/coded columns
 * work once given friendly `options`.
 */
function FilterSection<TData>({ column, label, options }: FilterableColumn<TData>) {
  const facets = column.getFacetedUniqueValues();
  const selected = new Set((column.getFilterValue() as string[] | undefined) ?? []);

  // Counts keyed by the stringified raw value so boolean/number columns line up
  // with the string option values we filter on.
  const counts = React.useMemo(() => {
    const map = new Map<string, number>();
    for (const [value, count] of facets) {
      map.set(String(value), (map.get(String(value)) ?? 0) + count);
    }
    return map;
  }, [facets]);

  const resolvedOptions: FacetOption[] = React.useMemo(() => {
    if (options && options.length > 0) return options;
    return Array.from(counts.keys())
      .filter((v) => v !== 'null' && v !== 'undefined' && v !== '')
      .sort((a, b) => a.localeCompare(b))
      .map((v) => ({ label: v, value: v }));
  }, [options, counts]);

  const toggle = (value: string) => {
    const next = new Set(selected);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    column.setFilterValue(next.size ? Array.from(next) : undefined);
  };

  if (resolvedOptions.length === 0) return null;

  return (
    <div className="space-y-1.5">
      <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">{label}</p>
      <div className="space-y-0.5">
        {resolvedOptions.map((option) => (
          <label
            key={option.value}
            className="hover:bg-accent flex cursor-pointer items-center gap-2 rounded-sm px-1 py-1 text-sm"
          >
            <Checkbox
              checked={selected.has(option.value)}
              onCheckedChange={() => toggle(option.value)}
              aria-label={option.label}
            />
            <span>{option.label}</span>
            {counts.get(option.value) !== undefined && (
              <span className="text-muted-foreground ml-auto font-mono text-xs">
                {counts.get(option.value)}
              </span>
            )}
          </label>
        ))}
      </div>
    </div>
  );
}

/**
 * A single "Filters" button (to the right of the search) whose popover holds a value
 * filter for every column that opted in via `meta.filterVariant`. An active count sits
 * on the button; "Clear all" resets every column filter at once.
 */
export function DataTableFilterPopover<TData>({
  columns,
  activeCount,
  onClearAll,
}: {
  columns: FilterableColumn<TData>[];
  activeCount: number;
  onClearAll: () => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" aria-label="Filters">
          <ListFilter className="h-4 w-4" aria-hidden="true" />
          <span className="hidden sm:inline">Filters</span>
          {activeCount > 0 && (
            <Badge variant="secondary" className="ml-1 rounded-sm px-1 font-normal">
              {activeCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-medium">Filters</span>
          {activeCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-auto px-1 py-0 text-xs"
              onClick={onClearAll}
            >
              Clear all
            </Button>
          )}
        </div>
        <div className="max-h-72 space-y-3 overflow-y-auto p-3">
          {columns.map((c) => (
            <FilterSection key={c.column.id} column={c.column} label={c.label} options={c.options} />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
