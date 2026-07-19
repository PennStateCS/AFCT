'use client';

import React, { useId, useMemo, useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { ChevronDown, Plus, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export type AudienceItem = { id: string; label: string };

/**
 * A chips-style multiselect for an assignment's audience (the default-schedule
 * students or groups). When every item is selected it collapses to a single
 * "All …" pill; unselect any and it lists the selected members as removable chips.
 * An "Add" popover (search + checkboxes, with Select all / Clear) toggles membership.
 */
export function AudienceSelect({
  label,
  items,
  value,
  onChange,
  allLabel,
  addLabel = 'Add',
  searchPlaceholder = 'Search…',
  emptyStateText = 'No options.',
  emptySelectionText = 'None selected',
  error,
  id,
}: {
  label: string;
  items: AudienceItem[];
  value: string[];
  onChange: (next: string[]) => void;
  /** Shown as a single pill when every item is selected, e.g. "All students". */
  allLabel: string;
  addLabel?: string;
  searchPlaceholder?: string;
  emptyStateText?: string;
  emptySelectionText?: string;
  error?: string;
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const generatedId = useId();
  const triggerId = id ?? generatedId;
  const errorId = `${triggerId}-error`;

  const selectedSet = useMemo(() => new Set(value), [value]);
  const labelById = useMemo(() => new Map(items.map((i) => [i.id, i.label])), [items]);
  const allSelected = items.length > 0 && value.length >= items.length;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? items.filter((i) => i.label.toLowerCase().includes(q)) : items;
  }, [items, search]);

  const toggle = (itemId: string) => {
    const next = new Set(value);
    if (next.has(itemId)) next.delete(itemId);
    else next.add(itemId);
    onChange([...next]);
  };
  const removeOne = (itemId: string) => onChange(value.filter((v) => v !== itemId));
  const selectAll = () => onChange(items.map((i) => i.id));
  const clearAll = () => onChange([]);

  return (
    <div className="flex flex-col">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <Label htmlFor={triggerId} className="text-sm font-medium">
          {label}
        </Label>
        {!allSelected && items.length > 0 ? (
          <button
            type="button"
            onClick={selectAll}
            className="text-primary text-xs font-medium hover:underline"
          >
            Select all
          </button>
        ) : null}
      </div>

      <div
        className={cn(
          'flex flex-wrap items-center gap-1.5 rounded-md border p-2',
          error ? 'border-red-500' : 'border-input',
        )}
      >
        {allSelected ? (
          <span className="bg-primary/10 text-primary rounded-full px-2.5 py-1 text-xs font-medium">
            {allLabel}
          </span>
        ) : value.length === 0 ? (
          <span className="text-muted-foreground px-1 text-sm">{emptySelectionText}</span>
        ) : (
          value.map((v) => (
            <span
              key={v}
              className="bg-muted flex items-center gap-1 rounded-full py-1 pr-1 pl-2.5 text-xs"
            >
              <span className="max-w-[12rem] truncate">{labelById.get(v) ?? v}</span>
              <button
                type="button"
                onClick={() => removeOne(v)}
                aria-label={`Remove ${labelById.get(v) ?? v}`}
                className="hover:bg-muted-foreground/20 rounded-full p-0.5"
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </span>
          ))
        )}

        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              id={triggerId}
              aria-describedby={error ? errorId : undefined}
              className={cn(
                'text-muted-foreground hover:bg-muted focus-visible:ring-ring/40 ml-auto inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs focus-visible:ring-2 focus-visible:outline-none',
                error && 'border-red-500',
              )}
            >
              <Plus className="h-3 w-3" aria-hidden="true" /> {addLabel}
              <ChevronDown className="h-3 w-3" aria-hidden="true" />
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            collisionPadding={8}
            aria-label={`${label} options`}
            className="bg-popover flex max-h-72 w-72 flex-col p-2"
          >
            <Input
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="mb-2 h-9 shrink-0 text-sm"
            />
            <div className="mb-1 flex items-center justify-between px-1">
              <button
                type="button"
                onClick={selectAll}
                className="text-primary text-xs hover:underline"
              >
                Select all
              </button>
              <button
                type="button"
                onClick={clearAll}
                className="text-muted-foreground text-xs hover:underline"
              >
                Clear
              </button>
            </div>
            <div
              role="group"
              aria-label={label}
              className="min-h-0 flex-1 overflow-auto rounded border"
            >
              {filtered.length === 0 ? (
                <div className="text-muted-foreground p-3 text-center text-sm">{emptyStateText}</div>
              ) : (
                filtered.map((item) => (
                  <label
                    key={item.id}
                    className="hover:bg-muted/50 flex cursor-pointer items-center gap-2 px-3 py-2 text-sm"
                  >
                    <Checkbox
                      checked={selectedSet.has(item.id)}
                      onCheckedChange={() => toggle(item.id)}
                    />
                    <span className="truncate">{item.label}</span>
                  </label>
                ))
              )}
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {error ? (
        <p id={errorId} role="alert" className="mt-1 text-xs text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}
