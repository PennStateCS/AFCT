'use client';

import * as React from 'react';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

export interface SwitchFieldProps {
  label: string;
  name: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  description?: string;
  descriptionPlacement?: 'below' | 'inline';
  error?: string;
  additionalDescribedBy?: string | string[];
  disabled?: boolean;
  className?: string;
  labelClassName?: string;
  switchClassName?: string;
  boxClassName?: string;
  id?: string;
}

export default function SwitchField({
  label,
  name,
  checked,
  onCheckedChange,
  description,
  descriptionPlacement = 'below',
  error,
  additionalDescribedBy,
  disabled,
  className,
  labelClassName,
  switchClassName,
  boxClassName,
  id,
}: SwitchFieldProps) {
  const switchId = id ?? name;
  const labelId = `${switchId}-label`;

  const describedByIds: Array<string | null> = [
    error ? `${switchId}-error` : null,
    description ? `${switchId}-desc` : null,
  ];

  if (additionalDescribedBy) {
    if (Array.isArray(additionalDescribedBy)) {
      describedByIds.push(...additionalDescribedBy);
    } else {
      describedByIds.push(additionalDescribedBy);
    }
  }

  const describedByAttr = describedByIds
    .filter((val): val is string => !!val && val.trim().length > 0)
    .join(' ')
    .trim();

  return (
    <div className={cn('flex flex-col', className)}>
      <div
        className={cn(
          'border-input flex min-h-11 items-center justify-between rounded-md border px-3 py-2 shadow-xs',
          boxClassName,
        )}
      >
        <div className="min-w-0">
          <label
            id={labelId}
            htmlFor={switchId}
            className={cn('text-sm font-medium', labelClassName)}
          >
            {label}
          </label>
          {description && descriptionPlacement === 'inline' && (
            <p id={`${switchId}-desc`} className="text-muted-foreground mt-0.5 text-xs">
              {description}
            </p>
          )}
        </div>
        <Switch
          id={switchId}
          aria-label={label}
          aria-labelledby={labelId}
          checked={checked}
          onCheckedChange={onCheckedChange}
          disabled={disabled}
          aria-invalid={!!error || undefined}
          aria-describedby={describedByAttr || undefined}
          className={switchClassName}
        />
      </div>

      {description && descriptionPlacement === 'below' && (
        <p id={`${switchId}-desc`} className="text-muted-foreground mt-1 text-xs">
          {description}
        </p>
      )}

      {error && (
        <p id={`${switchId}-error`} className="mt-1 text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
