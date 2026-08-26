import * as React from 'react';

import { Label } from '@/components/ui/label';
import { RequiredMark } from '@/components/ui/required-mark';
import { cn } from '@/lib/utils';

/**
 * The pieces every field wrapper in the app shares, in one place.
 *
 * InputGroup settled what a field looks like: a label row, the control, and at most one
 * message under it. SelectField, SearchableSelect, SearchableMultiSelect, SwitchField and
 * LimitField each grew their own copy of that, which is how they drifted apart (three
 * different label margins, two different describedby builders, error text at three
 * different line heights). These helpers are the shared version, so a change lands once.
 *
 * Deliberately small: this owns spacing, typography and ids, not layout or behaviour.
 */

/**
 * Surface, border, focus and state for anything that reads as a field.
 *
 * The trigger buttons in SelectTrigger and the two searchable selects are all "a box you
 * click that looks like an input", so they share this rather than each restating it. Size
 * and internal layout are NOT here: an h-9 toolbar select and an h-11 form select differ
 * in exactly those and nothing else.
 */
export const fieldControlClass =
  'bg-card border-input rounded-md border shadow-xs transition-[color,box-shadow] outline-none ' +
  'focus-visible:border-ring focus-visible:ring-ring/70 focus-visible:ring-[3px] ' +
  'aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 ' +
  'disabled:cursor-not-allowed disabled:opacity-50';

/**
 * Joins ids for `aria-describedby`, deduplicated, dropping anything empty.
 *
 * Callers pass `undefined` for a message they are not rendering, because an IDREF pointing
 * at a missing element is a dangling reference, and a repeated one is read twice.
 */
export function composeDescribedBy(
  ...ids: Array<string | string[] | undefined | null>
): string | undefined {
  const flat = ids
    .flatMap((id) => (Array.isArray(id) ? id : [id]))
    .filter((id): id is string => typeof id === 'string')
    .flatMap((id) => id.trim().split(/\s+/))
    .filter((id) => id.length > 0);

  const joined = Array.from(new Set(flat)).join(' ');
  return joined || undefined;
}

/**
 * The label row: the field's name, plus the required marker beside it.
 *
 * The marker is a sibling of the <label>, not a child, so the label's text (and therefore
 * the control's accessible name) stays exactly the field name. It carries the label's own
 * text size and `leading-none` so a required field is not a few pixels taller than the
 * plain one next to it.
 */
export function FieldLabelRow({
  htmlFor,
  id,
  required,
  className,
  labelClassName,
  children,
}: {
  htmlFor?: string;
  id?: string;
  required?: boolean;
  className?: string;
  labelClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('mb-0.5 flex items-center', className)}>
      <Label id={id} htmlFor={htmlFor} className={labelClassName}>
        {children}
      </Label>
      {required && <RequiredMark className="text-sm leading-none" />}
    </div>
  );
}

/**
 * Whether the description should be drawn, given the error state.
 *
 * One message under a field, not a stack of them: the error wins, so a dense form does not
 * carry helper text and an error at once and grow taller as it is filled in. Where the
 * description is what you need in order to *fix* the error (password rules, say), the
 * caller asks for both.
 */
export function shouldShowDescription(
  description: React.ReactNode,
  error: React.ReactNode,
  showDescriptionWithError?: boolean,
): boolean {
  return !!description && (!error || !!showDescriptionWithError);
}

/**
 * The message line(s) under a field.
 *
 * text-xs sets a 16px line box, which is tight for the two and three line descriptions on
 * the LTI and Sign-in tabs; 18px (leading-4.5) is 1.5 and still compact.
 */
export function FieldMessage({
  description,
  descriptionId,
  error,
  errorId,
  showDescriptionWithError,
  className,
}: {
  description?: React.ReactNode;
  descriptionId: string;
  error?: React.ReactNode;
  errorId: string;
  showDescriptionWithError?: boolean;
  className?: string;
}) {
  const showDescription = shouldShowDescription(description, error, showDescriptionWithError);

  return (
    <>
      {showDescription && (
        <p
          id={descriptionId}
          className={cn('text-muted-foreground text-xs leading-4.5', className)}
        >
          {description}
        </p>
      )}
      {error && (
        <p
          id={errorId}
          role="alert"
          className={cn('text-destructive text-xs leading-4.5', className)}
        >
          {error}
        </p>
      )}
    </>
  );
}
