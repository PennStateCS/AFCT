'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { FieldLabelRow, FieldMessage, composeDescribedBy, shouldShowDescription } from './field';

/**
 * A date and a time, as two native inputs rather than one `datetime-local`.
 *
 * The reason is the phone. Chrome for Android renders `datetime-local` as a stack of
 * spinning wheels, and its day wheel carries: scroll past the 30th of September and the
 * month wheel moves to October with it, so somebody flicking quickly lands on a date in
 * the wrong month and has to go back and fix two wheels instead of one. Nothing on our
 * side changes that, it is the platform's own dialog. `type="date"` opens the calendar
 * grid instead, where a day is a day. (The time input is still a wheel or a clock, and
 * minutes still carry into hours; that is what anyone would expect of a clock.)
 *
 * The value in and out is the same `YYYY-MM-DDTHH:mm` string `datetime-local` used, so
 * every form, schema and timezone conversion around this is untouched. See
 * `lib/date-convert` for the two ends of that round trip.
 */
export function DateTimeField({
  label,
  name,
  value,
  onChange,
  onBlur,
  error,
  description,
  min,
  requiredMark,
  disabled,
  defaultTime = '00:00',
  className,
  id,
}: {
  label: string;
  name: string;
  /** `YYYY-MM-DDTHH:mm`, or '' for no value. */
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  error?: string;
  description?: string;
  /** Lower bound as a full `datetime-local` string; only its date half binds the picker. */
  min?: string;
  requiredMark?: boolean;
  disabled?: boolean;
  /**
   * The time a bare date turns into. '00:00' suits a start or an opening; pass '23:59'
   * for a deadline, where the start of the day is never what someone means.
   */
  defaultTime?: string;
  className?: string;
  id?: string;
}) {
  const baseId = id ?? name;
  const labelId = `${baseId}-label`;
  const dateId = `${baseId}-date`;
  const timeId = `${baseId}-time`;
  const descId = `${baseId}-desc`;
  const errorId = `${baseId}-error`;

  /**
   * The time survives the date being cleared.
   *
   * With no date there is no value to hold a time in, so a time typed first (or left
   * behind when the date is cleared) would vanish from the field the user is looking at.
   * It is only a fallback: whenever there is a value, the value wins.
   */
  const [orphanTime, setOrphanTime] = React.useState('');

  const datePart = value ? value.slice(0, 10) : '';
  const timePart = value ? value.slice(11, 16) : orphanTime;

  const handleDate = (next: string) => {
    if (!next) {
      // Keep the time on screen; the field is simply not set until a date comes back.
      setOrphanTime(timePart);
      onChange('');
      return;
    }
    onChange(`${next}T${timePart || defaultTime}`);
  };

  const handleTime = (next: string) => {
    // Emptying the time snaps it back to the default rather than leaving a date with no
    // time in it: a half-set value that still looks set is the worse of the two.
    const time = next || defaultTime;
    setOrphanTime(time);
    if (datePart) onChange(`${datePart}T${time}`);
  };

  const showDescription = shouldShowDescription(description, error, false);
  const describedBy = composeDescribedBy(
    error ? errorId : undefined,
    showDescription ? descId : undefined,
  );

  // Both halves carry the field's own label in their accessible name, because on their own
  // "date" and "time" name a control but not which one (WCAG 2.5.3, and four of these can
  // sit on one form). The group ties them back to the visible label.
  const shared = {
    onBlur,
    disabled,
    'aria-invalid': !!error || undefined,
    'aria-required': requiredMark || undefined,
    'aria-describedby': describedBy,
    className: 'h-11 min-w-0',
  } as const;

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <FieldLabelRow id={labelId} htmlFor={dateId} required={requiredMark}>
        {label}
      </FieldLabelRow>

      {/* flex-wrap with a basis on each: side by side wherever there is room, stacked on a
          narrow phone rather than squeezed until the date reads "09/01/20…". */}
      <div role="group" aria-labelledby={labelId} className="flex flex-wrap gap-2">
        <Input
          {...shared}
          id={dateId}
          name={`${name}-date`}
          type="date"
          value={datePart}
          min={min ? min.slice(0, 10) : undefined}
          onChange={(e) => handleDate(e.target.value)}
          aria-label={`${label}, date`}
          className={cn(shared.className, 'flex-1 basis-36')}
        />
        <Input
          {...shared}
          id={timeId}
          name={`${name}-time`}
          type="time"
          value={timePart}
          onChange={(e) => handleTime(e.target.value)}
          aria-label={`${label}, time`}
          className={cn(shared.className, 'flex-1 basis-28')}
        />
      </div>

      <FieldMessage
        description={description}
        descriptionId={descId}
        error={error}
        errorId={errorId}
      />
    </div>
  );
}

export default DateTimeField;
