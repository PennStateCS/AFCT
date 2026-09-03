'use client';

import React, { useId, useMemo, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { FieldLabelRow, fieldControlClass } from '@/components/ui/field';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SelectItem {
  id: string;
  label: string;
  /**
   * A second line under the label, for telling two identical labels apart.
   *
   * Same rule as the multi-select's: shown under the name, searched alongside it, and part of
   * the option's accessible name, so two people called the same thing can be told apart by
   * eye, by typing an email address, and by a screen reader.
   */
  description?: string;
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
  /** Let a caller move focus elsewhere after a pick instead of returning to the trigger. */
  restoreFocusAfterSelect?: boolean;
  className?: string;
  triggerClassName?: string;
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
  restoreFocusAfterSelect = true,
  className,
  triggerClassName,
}: SearchableSelectProps) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const generatedId = useId();
  const triggerId = id ?? generatedId;
  // Tracks a just-picked selection so onCloseAutoFocus can honor restoreFocusAfterSelect.
  const selectedRef = useRef(false);
  // The options container, for roving arrow-key navigation over the buttons.
  const listRef = useRef<HTMLDivElement>(null);

  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return items;
    return items.filter(
      (item) =>
        item.label.toLowerCase().includes(query) ||
        (item.description ?? '').toLowerCase().includes(query),
    );
  }, [items, search]);

  const pick = (itemId: string) => {
    selectedRef.current = true;
    onSelect(itemId);
    setSearch('');
    setOpen(false);
  };

  // Roving keyboard navigation over the option buttons (real focus, not a listbox
  // with aria-activedescendant, which the previous roles implied but weren't wired).
  const optionButtons = () =>
    Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('[data-option]') ?? []);
  const focusOptionAt = (index: number) => {
    const buttons = optionButtons();
    if (buttons.length === 0) return;
    const clamped = Math.max(0, Math.min(index, buttons.length - 1));
    buttons[clamped]?.focus();
  };
  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusOptionAt(0);
    } else if (e.key === 'Enter') {
      // Enter in the search box picks the first match (keyboard shortcut).
      const first = filteredItems[0];
      if (first) {
        e.preventDefault();
        pick(first.id);
      }
    }
  };
  const handleOptionKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    const buttons = optionButtons();
    const current = buttons.indexOf(e.currentTarget);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusOptionAt(current + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      focusOptionAt(current - 1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      focusOptionAt(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      focusOptionAt(buttons.length - 1);
    }
  };

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      {label ? <FieldLabelRow htmlFor={triggerId}>{label}</FieldLabelRow> : null}
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
              // Surface, border, focus and the disabled treatment come from the shared
              // field class, the same one SelectTrigger uses, so this reads as the same
              // control even though it is a plain button rather than a Radix select.
              fieldControlClass,
              'text-muted-foreground flex h-11 w-full items-center justify-between px-3 text-base md:text-sm',
              triggerClassName,
            )}
          >
            <span className="min-w-0 flex-1 truncate text-left">{placeholder}</span>
            <ChevronDown className="text-muted-foreground ml-2 size-4 shrink-0" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          collisionPadding={8}
          aria-label={label ? `${label} options` : 'Options'}
          onCloseAutoFocus={(event) => {
            if (selectedRef.current && !restoreFocusAfterSelect) event.preventDefault();
            selectedRef.current = false;
          }}
          className="bg-popover flex max-h-72 w-[var(--radix-popover-trigger-width)] flex-col p-2"
        >
          <Input
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            className="mb-2 h-9 shrink-0 text-sm"
          />
          {/* A labeled group of option buttons (no listbox/option roles, since this
              uses real focus + arrow-key navigation rather than aria-activedescendant). */}
          <div
            ref={listRef}
            role="group"
            aria-label={label ? `${label} options` : 'Options'}
            className="min-h-0 flex-1 overflow-auto rounded border"
          >
            {filteredItems.length === 0 ? (
              <div className="text-muted-foreground p-3 text-center text-sm">{emptyStateText}</div>
            ) : (
              filteredItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  data-option
                  onClick={() => pick(item.id)}
                  onKeyDown={handleOptionKeyDown}
                  aria-label={
                    item.description ? `${item.label} (${item.description})` : undefined
                  }
                  className="hover:bg-muted focus-visible:bg-muted flex w-full cursor-pointer items-center px-3 py-2 text-left text-sm focus-visible:outline-none"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{item.label}</span>
                    {item.description ? (
                      <span className="text-muted-foreground block truncate text-xs">
                        {item.description}
                      </span>
                    ) : null}
                  </span>
                </button>
              ))
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
