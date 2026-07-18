'use client';

import React, { useId, useMemo, useState } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SelectItem {
  id: string;
  label: string;
}

interface SearchableSelectProps {
  label?: string;
  id?: string;
  items: SelectItem[];
  /** Called with the picked id. The picker then closes and clears its search. */
  onSelect: (id: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyStateText?: string;
  disabled?: boolean;
}

/**
 * A searchable single-select used as a "pick one, do something, close" action (e.g.
 * "add a student"). Unlike SearchableMultiSelect it holds no persistent value and closes
 * the moment an item is chosen, so it doesn't sit open blocking the UI.
 */
export function SearchableSelect({
  label,
  items,
  onSelect,
  placeholder = 'Select an option',
  searchPlaceholder = 'Search...',
  emptyStateText = 'No results found.',
  id,
  disabled,
}: SearchableSelectProps) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const generatedId = useId();
  const triggerId = id ?? generatedId;

  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return items;
    return items.filter((item) => item.label.toLowerCase().includes(query));
  }, [items, search]);

  const pick = (itemId: string) => {
    onSelect(itemId);
    setSearch('');
    setOpen(false);
  };

  return (
    <div className="flex flex-col">
      {label ? (
        <Label htmlFor={triggerId} className="mb-1.5 text-sm font-medium">
          {label}
        </Label>
      ) : null}
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setSearch('');
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            id={triggerId}
            disabled={disabled}
            className={cn(
              'border-input text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/40 flex h-11 w-full items-center justify-between rounded-md border bg-transparent px-3 text-sm shadow-xs transition-all duration-150 focus-visible:ring-[3px] focus-visible:outline-none',
              disabled && 'cursor-not-allowed opacity-60',
            )}
          >
            <span className="min-w-0 flex-1 truncate text-left">{placeholder}</span>
            <ChevronDown className="text-muted-foreground ml-2 h-4 w-4 shrink-0" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          collisionPadding={8}
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
            role="listbox"
            aria-label={label ?? 'Options'}
            className="min-h-0 flex-1 overflow-auto rounded border"
          >
            {filteredItems.length === 0 ? (
              <div className="text-muted-foreground p-3 text-center text-sm">{emptyStateText}</div>
            ) : (
              filteredItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="option"
                  aria-selected={false}
                  onClick={() => pick(item.id)}
                  className="hover:bg-muted/50 flex w-full cursor-pointer items-center px-3 py-2 text-left text-sm"
                >
                  <span className="truncate">{item.label}</span>
                </button>
              ))
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
