'use client';

import React, { useId, useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { FieldLabelRow, FieldMessage, fieldControlClass } from '@/components/ui/field';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface MultiSelectItem {
  id: string;
  label: string;
  /**
   * A second line under the label, for telling two identical labels apart.
   *
   * Two members of staff called the same thing are not a rarity in a university, and a list of
   * bare names asks somebody to guess which is which. Searched as well as shown, so typing an
   * email address finds the person; kept out of the trigger's summary, which has one line.
   */
  description?: string;
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
    return items.filter(
      (item) =>
        item.label.toLowerCase().includes(query) ||
        (item.description ?? '').toLowerCase().includes(query),
    );
  }, [items, search]);

  /**
   * What the closed control says is selected.
   *
   * Past two, the names are summarised rather than listed. A comma-joined list of long
   * names is wider than any sensible control, so it was truncated to something like
   * "Computer Science Theory, Automata, Computab…", which reads as the first item plus
   * noise and hides how many are actually selected. The count is the useful fact; the
   * names are one click away in the panel, which shows them checked.
   */
  const selectedLabels = useMemo(() => {
    if (!value?.length) return '';
    const map = new Map(items.map((item) => [item.id, item.label]));
    const labels = value.map((id) => map.get(id)).filter((l): l is string => !!l);
    if (labels.length === 0) return '';
    if (labels.length <= 2) return labels.join(', ');
    return `${labels.length} selected`;
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
    // min-w-0 because the trigger's label is `whitespace-nowrap` (it truncates), which makes
    // this control's min-content width the FULL selected text. As a flex or grid child that
    // minimum wins over a 1fr track, so a long selection pushed its siblings off screen and
    // gave the whole page a horizontal scrollbar instead of truncating.
    <div className="flex min-w-0 flex-col gap-1">
      {label ? <FieldLabelRow htmlFor={triggerId}>{label}</FieldLabelRow> : null}
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
              // The same shared field class as SelectTrigger and SearchableSelect, so all
              // three closed controls sit at one surface, border, focus and disabled
              // treatment. The invalid border comes from aria-invalid above, not a
              // separate `error &&` class that could disagree with it.
              fieldControlClass,
              'text-foreground flex h-11 w-full items-center justify-between px-3 text-base md:text-sm',
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
            <ChevronDown className="text-muted-foreground ml-2 size-4 shrink-0" />
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
                    className="hover:bg-muted flex cursor-pointer items-center gap-2 px-3 py-2 text-sm"
                  >
                    <Checkbox
                      // Radix renders a <button role="checkbox">, which takes no name
                      // from a wrapping <label>, so name it explicitly. The second line goes
                      // in the name too: two options reading "Bruce Wayne" are as ambiguous
                      // to a screen reader as they are on screen.
                      aria-label={
                        item.description ? `${item.label} (${item.description})` : item.label
                      }
                      checked={!!checked}
                      onCheckedChange={() => toggleSelection(item.id)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{item.label}</span>
                      {item.description ? (
                        <span className="text-muted-foreground block truncate text-xs">
                          {item.description}
                        </span>
                      ) : null}
                    </span>
                  </label>
                );
              })
            )}
          </div>
        </PopoverContent>
      </Popover>
      <FieldMessage
        error={error}
        errorId={`${triggerId}-error`}
        descriptionId={`${triggerId}-desc`}
      />
    </div>
  );
}
