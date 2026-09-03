import { Controller, type Control, type FieldPath, type FieldValues } from 'react-hook-form';
import { DateTimeField } from '@/components/ui/DateTimeField';

interface CourseDateTimeFieldProps<T extends FieldValues> {
  control: Control<T>;
  name: FieldPath<T>;
  label: string;
  error?: string;
  /** Lower bound for the picker (e.g. an end date can't precede the start). */
  min?: string;
  requiredMark?: boolean;
  /** See DateTimeField: the time a bare date turns into. Pass '23:59' for a deadline. */
  defaultTime?: string;
}

/**
 * A {@link DateTimeField} wired to a react-hook-form field. The course create and
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
  defaultTime,
}: CourseDateTimeFieldProps<T>) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <DateTimeField
          label={label}
          name={name}
          value={(field.value as string) ?? ''}
          onChange={field.onChange}
          onBlur={field.onBlur}
          error={error}
          min={min}
          requiredMark={requiredMark}
          defaultTime={defaultTime}
        />
      )}
    />
  );
}
