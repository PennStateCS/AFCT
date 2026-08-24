'use client';

import * as React from 'react';
import { Switch } from '@/components/ui/switch';
import { FieldMessage, composeDescribedBy, shouldShowDescription } from '@/components/ui/field';
import { cn } from '@/lib/utils';

export interface SwitchFieldProps {
  label: string;
  name: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  description?: string;
  descriptionPlacement?: 'below' | 'inline';
  error?: string;
  /**
   * Keep the description visible while an error is showing. Off by default, matching
   * InputGroup and SelectField. Only applies to the 'below' placement: an inline
   * description sits inside the row and is part of the setting's own label block.
   */
  showDescriptionWithError?: boolean;
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
  showDescriptionWithError,
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
  const descId = `${switchId}-desc`;
  const errorId = `${switchId}-error`;

  const inlineDescription = !!description && descriptionPlacement === 'inline';
  // The below-placement description follows the same error-wins rule as every other field;
  // an inline one is part of the row itself, so it stays put.
  const showBelowDescription =
    descriptionPlacement === 'below' &&
    shouldShowDescription(description, error, showDescriptionWithError);

  const describedByAttr = composeDescribedBy(
    error ? errorId : undefined,
    inlineDescription || showBelowDescription ? descId : undefined,
    additionalDescribedBy,
  );

  return (
    // gap-1 on the wrapper rather than a margin per message, matching InputGroup's rhythm.
    <div className={cn('flex flex-col gap-1', className)}>
      {/* The row is the hit target, not the switch: the label is a real <label htmlFor>
          pointing at the switch (Radix renders a labelable <button>), so clicking the
          setting's name toggles it without the square itself having to grow. */}
      <div
        className={cn(
          'border-input flex min-h-11 items-center justify-between gap-3 rounded-md border px-3 py-2 shadow-xs',
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
          {inlineDescription && (
            <p id={descId} className="text-muted-foreground mt-0.5 text-xs leading-4.5">
              {description}
            </p>
          )}
        </div>
        <Switch
          id={switchId}
          // aria-labelledby only: aria-label alongside it is redundant (labelledby wins)
          // and lets the two names drift apart.
          aria-labelledby={labelId}
          checked={checked}
          onCheckedChange={onCheckedChange}
          disabled={disabled}
          aria-invalid={!!error || undefined}
          aria-describedby={describedByAttr}
          className={switchClassName}
        />
      </div>

      <FieldMessage
        description={descriptionPlacement === 'below' ? description : undefined}
        descriptionId={descId}
        error={error}
        errorId={errorId}
        showDescriptionWithError={showDescriptionWithError}
      />
    </div>
  );
}
