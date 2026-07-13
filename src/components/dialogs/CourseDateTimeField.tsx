import React from 'react';
import { Controller, type Control, type FieldPath, type FieldValues } from 'react-hook-form';
import InputGroup from '@/components/ui/InputGroup';

interface CourseDateTimeFieldProps<T extends FieldValues> {
  control: Control<T>;
  name: FieldPath<T>;
  label: string;
  error?: string;
  /** Lower bound for the picker (e.g. an end date can't precede the start). */
  min?: string;
  requiredMark?: boolean;
  /** Show the "valid" adornment once a value is present (duplicate wizard). */
  showValidWhenSet?: boolean;
}

/**
 * A `datetime-local` InputGroup wired to a react-hook-form field. The course create and
 * duplicate wizards each render four of these with the same string-value/onChange adapter;
 * this collapses that boilerplate to one line per field.
 */
export function CourseDateTimeField<T extends FieldValues>({
  control,
  name,
  label,
  error,
  min,
  requiredMark,
  showValidWhenSet,
}: CourseDateTimeFieldProps<T>) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <InputGroup
          label={label}
          name={name}
          type="datetime-local"
          isValid={showValidWhenSet ? !!field.value : undefined}
          fieldProps={{
            ...field,
            value: (field.value as string) ?? '', // datetime-local wants a string
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => field.onChange(e.target.value),
          }}
          error={error}
          min={min}
          requiredMark={requiredMark}
        />
      )}
    />
  );
}
