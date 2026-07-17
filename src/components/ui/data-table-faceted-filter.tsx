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

  const labelId = React.useId();

  if (resolvedOptions.length === 0) return null;

  return (
    <div className="w-44 space-y-1.5">
      <p
        id={labelId}
        className="text-muted-foreground text-xs font-medium tracking-wide uppercase"
      >
        {label}
      </p>
      {/* Group the checkboxes under the section label so a screen reader announces
          e.g. "Registration group" when entering it. */}
      <div role="group" aria-labelledby={labelId} className="space-y-0.5">
        {resolvedOptions.map((option) => {
          const count = counts.get(option.value);
          return (
            <label
              key={option.value}
              className="hover:bg-accent flex cursor-pointer items-center gap-2 rounded-sm px-1 py-1 text-sm"
            >
              <Checkbox
                checked={selected.has(option.value)}
                onCheckedChange={() => toggle(option.value)}
                // Fold the match count into the name so it isn't read as a stray
                // number, but screen-reader users still get it.
                aria-label={count !== undefined ? `${option.label}, ${count} matching` : option.label}
              />
              <span>{option.label}</span>
              {count !== undefined && (
                <span aria-hidden="true" className="text-muted-foreground ml-auto font-mono text-xs">
                  {count}
                </span>
              )}
            </label>
          );
        })}
      </div>
    </div>
  );
}

/** Shared "Filters" button + popover frame. The body sections are passed as children,
 *  so both the column-faceted filter and the controlled server-side menu look identical. */
function FilterPopoverShell({
  activeCount,
  onClearAll,
  children,
}: {
  activeCount: number;
  onClearAll: () => void;
  children: React.ReactNode;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          aria-label={activeCount > 0 ? `Filters, ${activeCount} active` : 'Filters'}
        >
          <ListFilter className="h-4 w-4" aria-hidden="true" />
          <span className="hidden sm:inline">Filters</span>
          {activeCount > 0 && (
            <Badge variant="secondary" aria-hidden="true" className="ml-1 rounded-sm px-1 font-normal">
              {activeCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        // Grow to fill the space Radix has (its available-height/width vars) and only
        // scroll as a last resort. Sections flow into extra columns when tall, so a
        // long list uses horizontal room instead of a scrollbar where the screen allows.
        className="flex max-h-[var(--radix-popover-content-available-height)] w-auto max-w-[var(--radix-popover-content-available-width)] min-w-56 flex-col p-0"
      >
        <div className="flex shrink-0 items-center justify-between border-b px-3 py-2">
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
        {/* Column-direction wrap: sections stack vertically until they hit the popover's
            (viewport-bounded) height, then flow into another column, widening up to the
            available width before any scrollbar appears. */}
        <div className="flex min-h-0 flex-1 flex-col flex-wrap content-start gap-x-6 gap-y-3 overflow-auto p-3">
          {children}
        </div>
      </PopoverContent>
    </Popover>
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
    <FilterPopoverShell activeCount={activeCount} onClearAll={onClearAll}>
      {columns.map((c) => (
        <FilterSection key={c.column.id} column={c.column} label={c.label} options={c.options} />
      ))}
    </FilterPopoverShell>
  );
}

/** A controlled filter group for server-driven pages (no client-side table/faceting):
 *  a labelled block of checkboxes whose selection lives in the parent's state. */
export interface FilterMenuGroup {
  key: string;
  label: string;
  options: FacetOption[];
  selected: string[];
  onChange: (values: string[]) => void;
}

function ControlledFilterSection({ group }: { group: FilterMenuGroup }) {
  const labelId = React.useId();
  const selected = new Set(group.selected);
  const toggle = (value: string) => {
    const next = new Set(selected);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    group.onChange(Array.from(next));
  };
  return (
    <div className="w-44 space-y-1.5">
      <p id={labelId} className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
        {group.label}
      </p>
      <div role="group" aria-labelledby={labelId} className="space-y-0.5">
        {group.options.map((option) => (
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
          </label>
        ))}
      </div>
    </div>
  );
}

/**
 * The same "Filters" button + popover as the table faceted filter, but driven by
 * controlled props — for server-paginated pages (e.g. System Logs) that filter on the
 * server rather than over client rows. Each group is multi-select.
 */
export function DataTableFilterMenu({ groups }: { groups: FilterMenuGroup[] }) {
  const activeCount = groups.reduce((n, g) => n + g.selected.length, 0);
  const clearAll = () => groups.forEach((g) => g.onChange([]));
  return (
    <FilterPopoverShell activeCount={activeCount} onClearAll={clearAll}>
      {groups.map((g) => (
        <ControlledFilterSection key={g.key} group={g} />
      ))}
    </FilterPopoverShell>
  );
}
