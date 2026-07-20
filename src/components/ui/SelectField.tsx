'use client';

import * as React from 'react';
import { Label } from '@/components/ui/label';
import { RequiredMark } from '@/components/ui/required-mark';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

export type SelectFieldOption = {
  value: string;
  label: React.ReactNode;
  disabled?: boolean;
};

export interface SelectFieldProps extends Omit<React.ComponentProps<typeof Select>, 'children'> {
  label: string;
  name: string;
  placeholder?: string;
  description?: string;
  error?: string;
  // Marks the field required: renders the visible "*" next to the label and sets
  // aria-required on the trigger, so the requirement is conveyed both ways.
  requiredMark?: boolean;
  additionalDescribedBy?: string | string[];
  options?: SelectFieldOption[];
  className?: string;
  triggerClassName?: string;
  contentProps?: React.ComponentProps<typeof SelectContent>;
  children?: React.ReactNode;
  id?: string;
}

const SelectField = React.forwardRef<React.ElementRef<typeof SelectTrigger>, SelectFieldProps>(
  function SelectField(
    {
      label,
      name,
      placeholder,
      description,
      error,
      // Destructured so it isn't forwarded onto the Select/DOM; it drives the label's
      // marker and the trigger's aria-required below.
      requiredMark: _requiredMark,
      additionalDescribedBy,
      options,
      className,
      triggerClassName,
      contentProps,
      children,
      id,
      disabled,
      ...selectProps
    },
    ref,
  ) {
    const triggerId = id ?? name;
    const labelId = `${triggerId}-label`;

    const describedByIds: Array<string | null> = [
      error ? `${triggerId}-error` : null,
      description ? `${triggerId}-desc` : null,
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
        {/* The marker sits beside the label, not inside it, so the label text stays the
            bare field name for both the accessible name and label-based queries. */}
        <div className="flex items-center">
          <Label id={labelId} htmlFor={triggerId} className="mb-1.5 text-sm font-medium">
            {label}
          </Label>
          {_requiredMark && <RequiredMark className="mb-1.5" />}
        </div>

        <Select name={name} disabled={disabled} {...selectProps}>
          <SelectTrigger
            ref={ref}
            id={triggerId}
            aria-label={label}
            aria-labelledby={labelId}
            aria-required={_requiredMark || undefined}
            aria-invalid={!!error || undefined}
            aria-describedby={describedByAttr || undefined}
            disabled={disabled}
            className={cn(
              'border-input focus-visible:border-ring focus-visible:ring-ring/50 placeholder:text-muted-foreground data-[placeholder]:text-muted-foreground flex !h-11 w-full min-w-0 items-center justify-between rounded-md border bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
              error && 'border-red-500 focus-visible:border-red-500',
              triggerClassName,
            )}
          >
            <SelectValue placeholder={placeholder} />
          </SelectTrigger>
          {children ? (
            children
          ) : (
            <SelectContent {...contentProps}>
              {options?.map((option) => (
                <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
                  <span className="block truncate max-w-[16rem]">{option.label}</span>
                </SelectItem>
              ))}
            </SelectContent>
          )}
        </Select>

        {description && (
          <p id={`${triggerId}-desc`} className="text-muted-foreground mt-1 text-xs">
            {description}
          </p>
        )}

        {error && (
          <p id={`${triggerId}-error`} role="alert" className="mt-1 text-xs text-red-600">
            {error}
          </p>
        )}
      </div>
    );
  },
);

SelectField.displayName = 'SelectField';

export default SelectField;
