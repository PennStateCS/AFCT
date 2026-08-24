'use client';

import * as React from 'react';
import {
  FieldLabelRow,
  FieldMessage,
  composeDescribedBy,
  shouldShowDescription,
} from '@/components/ui/field';
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
  /**
   * Keep the description visible while an error is showing. Off by default, matching
   * InputGroup: one message under a field reads better than a stack of them.
   */
  showDescriptionWithError?: boolean;
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
  // Options truncate to one line by default (keeps most dropdowns compact). Pass false
  // to let long labels wrap and show in full, e.g. long assignment titles.
  truncateOptions?: boolean;
}

const SelectField = React.forwardRef<React.ElementRef<typeof SelectTrigger>, SelectFieldProps>(
  function SelectField(
    {
      label,
      name,
      placeholder,
      description,
      error,
      showDescriptionWithError,
      // Destructured so it isn't forwarded onto the Select/DOM; it drives the label's
      // marker and the trigger's aria-required below.
      requiredMark,
      additionalDescribedBy,
      options,
      className,
      triggerClassName,
      contentProps,
      children,
      id,
      disabled,
      truncateOptions = true,
      ...selectProps
    },
    ref,
  ) {
    const triggerId = id ?? name;
    const labelId = `${triggerId}-label`;
    const descId = `${triggerId}-desc`;
    const errorId = `${triggerId}-error`;

    const describedByAttr = composeDescribedBy(
      error ? errorId : undefined,
      shouldShowDescription(description, error, showDescriptionWithError) ? descId : undefined,
      additionalDescribedBy,
    );

    return (
      // The same rhythm as InputGroup, owned by one gap on the wrapper rather than a
      // margin on each piece: 4px between the label row, the control and the message,
      // plus 2px more under the label. A form mixes both wrappers in one column.
      <div className={cn('flex flex-col gap-1', className)}>
        <FieldLabelRow id={labelId} htmlFor={triggerId} required={requiredMark}>
          {label}
        </FieldLabelRow>

        <Select name={name} disabled={disabled} {...selectProps}>
          <SelectTrigger
            ref={ref}
            id={triggerId}
            size="form"
            // aria-labelledby only. It carried aria-label as well, which the spec makes
            // redundant (labelledby wins) and which quietly allows the two names to drift.
            aria-labelledby={labelId}
            aria-required={requiredMark || undefined}
            aria-invalid={!!error || undefined}
            aria-describedby={describedByAttr}
            disabled={disabled}
            // Only what this wrapper owns. Surface, border, typography, radius, focus, the
            // aria-invalid border and the disabled state all live on SelectTrigger; the
            // long copy of them that used to be here is what let the two drift apart.
            className={triggerClassName}
          >
            <SelectValue placeholder={placeholder} />
          </SelectTrigger>
          {children ? (
            children
          ) : (
            <SelectContent {...contentProps}>
              {options?.map((option) => (
                <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
                  <span
                    className={cn(
                      'block',
                      truncateOptions ? 'max-w-[16rem] truncate' : 'break-words',
                    )}
                  >
                    {option.label}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          )}
        </Select>

        <FieldMessage
          description={description}
          descriptionId={descId}
          error={error}
          errorId={errorId}
          showDescriptionWithError={showDescriptionWithError}
        />
      </div>
    );
  },
);

SelectField.displayName = 'SelectField';

export default SelectField;
