'use client';

import { useId, useMemo, useState } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
  const triggerId = id ?? useId();

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
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            id={triggerId}
            aria-haspopup="listbox"
            aria-expanded={menuOpen}
            aria-invalid={!!error || undefined}
            aria-describedby={describedBy}
            disabled={disabled}
            className={cn(
              'border-input text-foreground focus-visible:border-ring focus-visible:ring-ring/40 flex h-11 w-full items-center justify-between rounded-md border bg-transparent px-3 text-sm shadow-xs transition-all duration-150 focus-visible:ring-[3px] focus-visible:outline-none',
              disabled && 'cursor-not-allowed opacity-60',
              error && 'border-red-500',
            )}
          >
            <span className={cn('truncate text-left', !selectedLabels && 'text-muted-foreground')}>
              {selectedLabels || placeholder}
            </span>
            <ChevronDown className="text-muted-foreground h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="bg-popover w-[var(--radix-dropdown-menu-trigger-width)] p-2">
          <Input
            placeholder={searchPlaceholder}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            className="mb-2 h-9 text-sm"
          />
          <div className="max-h-64 overflow-auto rounded border">
            {filteredItems.length === 0 ? (
              <div className="text-muted-foreground p-3 text-center text-sm">{emptyStateText}</div>
            ) : (
              filteredItems.map((item) => {
                const checked = value?.includes(item.id);
                return (
                  <label
                    key={item.id}
                    className="hover:bg-muted/50 flex cursor-pointer items-center gap-2 px-3 py-2 text-sm"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      checked={!!checked}
                      onChange={() => toggleSelection(item.id)}
                      className="h-4 w-4"
                    />
                    <span className="truncate">{item.label}</span>
                  </label>
                );
              })
            )}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
      {error ? (
        <p id={describedBy} className="mt-1 text-xs text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}
