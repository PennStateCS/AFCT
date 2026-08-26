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

export interface FacetSection {
  label: string;
  options: FacetOption[];
}

export interface FilterableColumn<TData> {
  column: Column<TData, unknown>;
  label: string;
  /** Fixed, friendly options; falls back to the distinct values in the data. */
  options?: FacetOption[];
  /** Show this column's options under several headings instead of one. They still
   *  belong to a single column filter, so ticking across headings ORs as usual. */
  sections?: FacetSection[];
}

/** One heading plus its checkboxes. Several of these can share a column. */
function FilterBlock({
  label,
  options,
  counts,
  selected,
  onToggle,
}: {
  label: string;
  options: FacetOption[];
  counts: Map<string, number>;
  selected: Set<string>;
  onToggle: (value: string) => void;
}) {
  const labelId = React.useId();
  return (
    <div className="w-44 space-y-1.5">
      {/* Heading rule + full-strength text: without it the sections read as one
          undivided list of checkboxes, so e.g. On time / Late looks like part of the
          group above it rather than a filter of its own. */}
      <p
        id={labelId}
        className="text-foreground border-b pb-1 text-xs font-semibold tracking-wide uppercase"
      >
        {label}
      </p>
      {/* Group the checkboxes under the section label so a screen reader announces
          e.g. "Registration group" when entering it. */}
      <div role="group" aria-labelledby={labelId} className="space-y-0.5">
        {options.map((option) => {
          const count = counts.get(option.value);
          return (
            <label
              key={option.value}
              className="hover:bg-accent flex cursor-pointer items-center gap-2 rounded-sm px-1 py-1 text-sm"
            >
              <Checkbox
                checked={selected.has(option.value)}
                onCheckedChange={() => onToggle(option.value)}
                // Fold the match count into the name so it isn't read as a stray
                // number, but screen-reader users still get it.
                aria-label={
                  count !== undefined ? `${option.label}, ${count} matching` : option.label
                }
              />
              <span>{option.label}</span>
              {count !== undefined && (
                <span
                  aria-hidden="true"
                  className="text-muted-foreground ml-auto font-mono text-xs"
                >
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

/**
 * One column's value filter, rendered as a labelled block of checkboxes inside the
 * shared filter popover. Selecting several values ORs them within the column; the
 * selection is stored as a string[] on the column filter and matched by the table's
 * multiselect filterFn. Values are compared as strings, so boolean/coded columns
 * work once given friendly `options`.
 *
 * A column may split its options across several headings via `sections`; they remain
 * one filter, so the OR still holds across the headings.
 */
function FilterSection<TData>({ column, label, options, sections }: FilterableColumn<TData>) {
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

  const resolvedSections: FacetSection[] = React.useMemo(() => {
    if (sections && sections.length > 0) return sections;
    if (options && options.length > 0) return [{ label, options }];
    const derived = Array.from(counts.keys())
      .filter((v) => v !== 'null' && v !== 'undefined' && v !== '')
      .sort((a, b) => a.localeCompare(b))
      .map((v) => ({ label: v, value: v }));
    return [{ label, options: derived }];
  }, [sections, options, label, counts]);

  const toggle = (value: string) => {
    const next = new Set(selected);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    column.setFilterValue(next.size ? Array.from(next) : undefined);
  };

  if (resolvedSections.every((s) => s.options.length === 0)) return null;

  return (
    <>
      {resolvedSections.map((section) => (
        <FilterBlock
          key={section.label}
          label={section.label}
          options={section.options}
          counts={counts}
          selected={selected}
          onToggle={toggle}
        />
      ))}
    </>
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
          variant="secondary"
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
        <div className="flex min-h-0 flex-1 flex-col flex-wrap content-start gap-x-6 gap-y-5 overflow-auto p-3">
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
        <FilterSection
          key={c.column.id}
          column={c.column}
          label={c.label}
          options={c.options}
          sections={c.sections}
        />
      ))}
    </FilterPopoverShell>
  );
}

/** A controlled filter group for server-driven pages (no client-side table/faceting):
 *  a labelled block of checkboxes whose selection lives in the parent's state. */
export interface FilterMenuGroup {
  key: string;
  label: string;
  /** The group's values. Ignored when `sections` is given. */
  options?: FacetOption[];
  /**
   * Split the group's values across several headings while keeping them ONE filter, the
   * controlled twin of a column's `meta.filterSections`. Use it when the values are
   * mutually exclusive but read as two questions: separate groups would AND on the server,
   * so any cross-heading pick could only ever return nothing, and the active-filter count
   * would double.
   */
  sections?: { label: string; options: FacetOption[] }[];
  selected: string[];
  onChange: (values: string[]) => void;
}

// Server-driven menus have no faceted row model, so there are no per-value match counts.
// A shared empty map keeps FilterBlock's count rendering switched off.
const NO_COUNTS = new Map<string, number>();

function ControlledFilterSection({ group }: { group: FilterMenuGroup }) {
  const selected = new Set(group.selected);
  const toggle = (value: string) => {
    const next = new Set(selected);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    group.onChange(Array.from(next));
  };
  const sections = group.sections ?? [{ label: group.label, options: group.options ?? [] }];
  return (
    <>
      {sections.map((section) => (
        <FilterBlock
          key={section.label}
          label={section.label}
          options={section.options}
          counts={NO_COUNTS}
          selected={selected}
          onToggle={toggle}
        />
      ))}
    </>
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
