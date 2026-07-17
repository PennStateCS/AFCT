'use client';

import * as React from 'react';
import type { Column } from '@tanstack/react-table';
import { Check, ListFilter } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

export interface FacetOption {
  label: string;
  value: string;
}

/**
 * A single column's value filter: a dropdown of the distinct values that column
 * holds, each toggleable. Selecting several values ORs them within the column;
 * different columns' filters AND together (standard react-table columnFilters).
 * The filter value is stored as a string[] and matched by the table's multiselect
 * filterFn, so this stays in sync with `column.getFilterValue()`.
 */
export function DataTableFacetedFilter<TData, TValue>({
  column,
  title,
  options,
}: {
  column: Column<TData, TValue>;
  title: string;
  /** Optional fixed option list (value + friendly label). Falls back to the
   *  distinct values found in the data (e.g. for plain string columns). */
  options?: FacetOption[];
}) {
  const facets = column.getFacetedUniqueValues();
  const selectedValues = new Set((column.getFilterValue() as string[] | undefined) ?? []);

  // Counts keyed by the stringified raw value so boolean/number columns line up
  // with the string option values we filter on.
  const counts = React.useMemo(() => {
    const map = new Map<string, number>();
    for (const [value, count] of facets) {
      map.set(String(value), (map.get(String(value)) ?? 0) + count);
    }
    return map;
  }, [facets]);

  // Without an explicit option list, derive one from the values present in the data.
  const resolvedOptions: FacetOption[] = React.useMemo(() => {
    if (options && options.length > 0) return options;
    return Array.from(counts.keys())
      .filter((v) => v !== 'null' && v !== 'undefined' && v !== '')
      .sort((a, b) => a.localeCompare(b))
      .map((v) => ({ label: v, value: v }));
  }, [options, counts]);

  const commit = (next: Set<string>) => {
    const arr = Array.from(next);
    column.setFilterValue(arr.length ? arr : undefined);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="border-dashed">
          <ListFilter className="h-4 w-4" aria-hidden="true" />
          {title}
          {selectedValues.size > 0 && (
            <>
              <Separator orientation="vertical" className="mx-1 h-4" />
              <Badge variant="secondary" className="rounded-sm px-1 font-normal lg:hidden">
                {selectedValues.size}
              </Badge>
              <div className="hidden gap-1 lg:flex">
                {selectedValues.size > 2 ? (
                  <Badge variant="secondary" className="rounded-sm px-1 font-normal">
                    {selectedValues.size} selected
                  </Badge>
                ) : (
                  resolvedOptions
                    .filter((option) => selectedValues.has(option.value))
                    .map((option) => (
                      <Badge
                        key={option.value}
                        variant="secondary"
                        className="rounded-sm px-1 font-normal"
                      >
                        {option.label}
                      </Badge>
                    ))
                )}
              </div>
            </>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-0" align="start">
        <Command>
          <CommandInput placeholder={title} />
          <CommandList>
            <CommandEmpty>No values.</CommandEmpty>
            <CommandGroup>
              {resolvedOptions.map((option) => {
                const isSelected = selectedValues.has(option.value);
                return (
                  <CommandItem
                    key={option.value}
                    onSelect={() => {
                      const next = new Set(selectedValues);
                      if (isSelected) next.delete(option.value);
                      else next.add(option.value);
                      commit(next);
                    }}
                  >
                    <div
                      className={cn(
                        'flex h-4 w-4 items-center justify-center rounded-sm border border-primary',
                        isSelected
                          ? 'bg-primary text-primary-foreground'
                          : 'opacity-50 [&_svg]:invisible',
                      )}
                    >
                      <Check className="h-3 w-3" />
                    </div>
                    <span>{option.label}</span>
                    {counts.get(option.value) !== undefined && (
                      <span className="text-muted-foreground ml-auto flex h-4 w-4 items-center justify-center font-mono text-xs">
                        {counts.get(option.value)}
                      </span>
                    )}
                  </CommandItem>
                );
              })}
            </CommandGroup>
            {selectedValues.size > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem
                    onSelect={() => column.setFilterValue(undefined)}
                    className="justify-center text-center"
                  >
                    Clear filter
                  </CommandItem>
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
