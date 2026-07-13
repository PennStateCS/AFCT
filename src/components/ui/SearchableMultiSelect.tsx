'use client';

import React, { useId, useMemo, useState } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface MultiSelectItem {
  id: string;
  label: string;
}

interface SearchableMultiSelectProps {
  label?: string;
  id?: string;
  items: MultiSelectItem[];
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyStateText?: string;
  error?: string;
  isValid?: boolean;
  disabled?: boolean;
}

export function SearchableMultiSelect({
  label,
  items,
  value,
  onChange,
  placeholder = 'Select options',
  searchPlaceholder = 'Search...',
  emptyStateText = 'No results found.',
  error,
  id,
  disabled,
}: SearchableMultiSelectProps) {
  const [search, setSearch] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  // Call useId() unconditionally (hooks must run in the same order every render);
  // fall back to it only when no explicit id was provided.
  const generatedId = useId();
  const triggerId = id ?? generatedId;

  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return items;
    return items.filter((item) => item.label.toLowerCase().includes(query));
  }, [items, search]);

  const selectedLabels = useMemo(() => {
    if (!value?.length) return '';
    const map = new Map(items.map((item) => [item.id, item.label]));
    return value
      .map((id) => map.get(id))
      .filter(Boolean)
      .join(', ');
  }, [items, value]);

  const toggleSelection = (id: string) => {
    const next = new Set(value ?? []);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    onChange(Array.from(next));
  };

  const describedBy = error ? `${triggerId}-error` : undefined;

  return (
    <div className="flex flex-col">
      {label ? (
        <Label htmlFor={triggerId} className="mb-1.5 text-sm font-medium">
          {label}
        </Label>
      ) : null}
      {/* A disclosure (Popover), not a menu: the panel holds a search box and a
          group of real checkboxes, so a menu's role/roving-focus model would be a
          lie. Radix Popover.Trigger supplies aria-haspopup="dialog", aria-expanded,
          and aria-controls; each checkbox conveys its own name + checked state. */}
      <Popover open={menuOpen} onOpenChange={setMenuOpen}>
        {/* aria-invalid is intentional on this combobox-style trigger so AT hears
            the validation state; the jsx-a11y rule wrongly treats it as
            unsupported on the button role. */}
        {/* eslint-disable jsx-a11y/role-supports-aria-props */}
        <PopoverTrigger asChild>
          <button
            type="button"
            id={triggerId}
            aria-invalid={!!error || undefined}
            aria-describedby={describedBy}
            disabled={disabled}
            className={cn(
              'border-input text-foreground focus-visible:border-ring focus-visible:ring-ring/40 flex h-11 w-full items-center justify-between rounded-md border bg-transparent px-3 text-sm shadow-xs transition-all duration-150 focus-visible:ring-[3px] focus-visible:outline-none',
              disabled && 'cursor-not-allowed opacity-60',
              error && 'border-red-500',
            )}
          >
            <span
              className={cn(
                'min-w-0 flex-1 truncate text-left',
                !selectedLabels && 'text-muted-foreground',
              )}
            >
              {selectedLabels || placeholder}
            </span>
            <ChevronDown className="text-muted-foreground ml-2 h-4 w-4 shrink-0" />
          </button>
        </PopoverTrigger>
        {/* eslint-enable jsx-a11y/role-supports-aria-props */}
        <PopoverContent
          align="start"
          collisionPadding={8}
          // Name the disclosure panel so its dialog role isn't anonymous to AT.
          aria-label={label ? `${label} options` : 'Options'}
          className="bg-popover flex max-h-72 w-[var(--radix-popover-trigger-width)] flex-col p-2"
        >
          <Input
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="mb-2 h-9 shrink-0 text-sm"
          />
          <div
            role="group"
            aria-label={label ?? 'Options'}
            className="min-h-0 flex-1 overflow-auto rounded border"
          >
            {filteredItems.length === 0 ? (
              <div className="text-muted-foreground p-3 text-center text-sm">{emptyStateText}</div>
            ) : (
              filteredItems.map((item) => {
                const checked = value?.includes(item.id);
                return (
                  <label
                    key={item.id}
                    className="hover:bg-muted/50 flex cursor-pointer items-center gap-2 px-3 py-2 text-sm"
                  >
                    <Checkbox
                      checked={!!checked}
                      onCheckedChange={() => toggleSelection(item.id)}
                    />
                    <span className="truncate">{item.label}</span>
                  </label>
                );
              })
            )}
          </div>
        </PopoverContent>
      </Popover>
      {error ? (
        <p id={describedBy} role="alert" className="mt-1 text-xs text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}
