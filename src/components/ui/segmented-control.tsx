'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

export type SegmentedOption = { value: string; label: string };

type SegmentedControlProps = {
  /** Shared radio-group name; must be unique on the page. */
  name: string;
  value: string;
  onValueChange: (value: string) => void;
  options: SegmentedOption[];
  ariaLabel?: string;
  disabled?: boolean;
  className?: string;
};

/**
 * A small two-plus-option segmented toggle built on native radios, so keyboard
 * (arrow keys move within the group) and screen-reader semantics come for free. The
 * radios are visually hidden; the surrounding label is the visible pill. A
 * `has-[:focus-visible]` ring keeps the focused segment visible for keyboard users.
 */
export function SegmentedControl({
  name,
  value,
  onValueChange,
  options,
  ariaLabel,
  disabled,
  className,
}: SegmentedControlProps) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        'bg-muted inline-flex rounded-md border border-black p-0.5',
        disabled && 'opacity-50',
        className,
      )}
    >
      {options.map((opt) => {
        const checked = value === opt.value;
        return (
          <label
            key={opt.value}
            className={cn(
              'cursor-pointer rounded-[0.3rem] px-3 py-1 text-sm font-medium transition-colors',
              'has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-offset-1',
              checked
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
              disabled && 'pointer-events-none',
            )}
          >
            <input
              type="radio"
              name={name}
              value={opt.value}
              checked={checked}
              disabled={disabled}
              onChange={() => onValueChange(opt.value)}
              className="sr-only"
            />
            {opt.label}
          </label>
        );
      })}
    </div>
  );
}

export default SegmentedControl;
