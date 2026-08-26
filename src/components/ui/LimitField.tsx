'use client';

import * as React from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { FieldMessage } from '@/components/ui/field';
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
    // gap-1 on the wrapper, like InputGroup, so the number input and its error keep the
    // same 4px rhythm as every other field. The label row keeps a little more air under it
    // because the segmented control shares that line.
    <div className={cn('flex flex-col gap-1', className)}>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
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
            // Only the height. border-input and the invalid border are Input's own, and
            // restating them here was a second copy that could disagree with the first.
            className="h-11"
          />
          <FieldMessage error={error} errorId={errorId} descriptionId={`${inputId}-desc`} />
        </>
      )}
    </div>
  );
}

export default LimitField;
