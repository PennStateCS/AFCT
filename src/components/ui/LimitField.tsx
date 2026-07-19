'use client';

import * as React from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { cn } from '@/lib/utils';

type LimitFieldProps = {
  label: string;
  /** Unique id/name base for the input and its radio group. */
  name: string;
  unlimited: boolean;
  onUnlimitedChange: (unlimited: boolean) => void;
  value: number | string | null | undefined;
  onValueChange: (value: string) => void;
  onValueBlur?: () => void;
  min?: number;
  max?: number;
  placeholder?: string;
  error?: string;
  disabled?: boolean;
  className?: string;
};

/**
 * A labelled "Unlimited / Limited" segmented toggle. When "Limited" is selected a number
 * input appears beneath it; when "Unlimited" is selected no input is shown (so there is no
 * empty disabled box). Replaces the older number-input-plus-Unlimited-checkbox pattern.
 */
export function LimitField({
  label,
  name,
  unlimited,
  onUnlimitedChange,
  value,
  onValueChange,
  onValueBlur,
  min = 1,
  max,
  placeholder,
  error,
  disabled,
  className,
}: LimitFieldProps) {
  const inputId = `${name}-value`;
  const errorId = `${inputId}-error`;

  return (
    <div className={cn('flex flex-col', className)}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        {/* Only associate the label with the input when the input is actually rendered. */}
        <Label htmlFor={unlimited ? undefined : inputId} className="text-sm font-medium">
          {label}
        </Label>
        <SegmentedControl
          name={`${name}-mode`}
          ariaLabel={`${label}: unlimited or limited`}
          value={unlimited ? 'unlimited' : 'limited'}
          onValueChange={(v) => onUnlimitedChange(v === 'unlimited')}
          disabled={disabled}
          options={[
            { value: 'unlimited', label: 'Unlimited' },
            { value: 'limited', label: 'Limited' },
          ]}
        />
      </div>

      {!unlimited && (
        <>
          <Input
            id={inputId}
            name={name}
            type="number"
            inputMode="numeric"
            min={min}
            max={max}
            placeholder={placeholder}
            disabled={disabled}
            value={value == null ? '' : String(value)}
            onChange={(e) => onValueChange(e.target.value)}
            onBlur={onValueBlur}
            aria-label={label}
            aria-invalid={!!error || undefined}
            aria-describedby={error ? errorId : undefined}
            className={cn('bg-card h-11 border-black', error && 'border-red-500')}
          />
          {error && (
            <p id={errorId} role="alert" className="mt-1 text-xs text-red-600">
              {error}
            </p>
          )}
        </>
      )}
    </div>
  );
}

export default LimitField;
