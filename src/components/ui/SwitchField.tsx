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
  /**
   * Where the description sits relative to the switch.
   *
   * `inline` puts it in the left-hand text block, directly under the label, and the switch
   * centres against the pair. That is the setting-row look, and it is what almost every
   * call site wants.
   *
   * `below` puts it on its own full-width line under the whole row. It is for a narrow
   * column (the Evaluator Sandbox's grid cell, a card), where sharing the line with the
   * switch would squeeze the text to a few words per line. It is the default because it is
   * the safer of the two in a container of unknown width.
   */
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
  /** The label-and-switch row itself, for the rare caller that needs to adjust its spacing. */
  rowClassName?: string;
  id?: string;
}

/**
 * A settings row: the name of the setting on the left, the switch on the right.
 *
 * Deliberately *not* a field box. It used to render inside `border-input ... shadow-xs`,
 * which is the boundary of something you type into, so a column of toggles read as a stack
 * of empty text inputs that happened to have switches in them. A toggle has no value to
 * contain and nothing to type, so it gets no container: the section panel around it is
 * what groups these rows, and the switch is what says this is a control.
 */
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
  rowClassName,
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
    <div className={cn('flex flex-col gap-1', className)}>
      {/*
        items-center centres the switch against the whole text block, so a wrapped
        two-line description keeps it in the middle rather than pinned to the first line.
        min-h-11 is the touch target: without it a bare row is only as tall as its 20px
        label, and the switch is 20px of that. It costs nothing on a described row.
      */}
      <div className={cn('flex min-h-11 items-center justify-between gap-4 py-1.5', rowClassName)}>
        {/* min-w-0 so a long description wraps inside this block instead of widening it
            and pushing the switch off the row. flex-1 so it takes the space the switch
            does not need. */}
        <div className={cn('min-w-0 flex-1', disabled && 'opacity-50')}>
          {/*
            A real <label htmlFor>, pointing at Radix's <button role="switch">, which is a
            labelable element: that is what makes the setting's name the accessible name
            AND makes clicking it toggle the switch, so the small control is not the only
            hit target. `block` widens that target to the full text column.

            The description is a sibling, not a child: inside the label it would be read
            as part of the accessible name ("24-hour clock Display times on a 24-hour
            clock instead of...") every time the control was announced.
          */}
          <label
            id={labelId}
            htmlFor={switchId}
            className={cn(
              'block text-sm font-medium',
              // A disabled control's label does not toggle it (the browser skips label
              // activation for a disabled control), so this is only about not looking
              // like it would.
              disabled ? 'cursor-not-allowed' : 'cursor-pointer',
              labelClassName,
            )}
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
          className={cn('shrink-0', switchClassName)}
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
