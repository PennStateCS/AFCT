'use client';

import * as React from 'react';

import { Label } from '@/components/ui/label';
import { RichDescriptionEditor } from './RichDescriptionEditor';
import type { RichDescriptionEnvelope } from '@/lib/rich-description';

export type RichDescriptionFieldProps = {
  /** Visible label. Also the editor's accessible name. */
  label?: string;
  /**
   * Initial value: a stored envelope, or a plain string for a legacy record (converted through
   * the shared utility). Treated as initial content only, like the editor itself.
   */
  value?: RichDescriptionEnvelope | string | null;
  onChange: (value: RichDescriptionEnvelope) => void;
  /** Helper text under the editor. */
  help?: React.ReactNode;
  error?: string;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  minHeightClassName?: string;
};

/**
 * A labelled form field wrapping RichDescriptionEditor: label, editor with toolbar, optional
 * help text, and an inline error. Every form that edits a description uses this rather than
 * mounting the editor directly, so the label/help/error wiring stays identical across the
 * assignment and problem surfaces.
 *
 * Note on when a record becomes rich: the editor emits only on a real edit, never on mount, so
 * a caller that forwards `onChange` into its payload converts a legacy plain-text record only
 * when the author actually changed the description and saved.
 */
export function RichDescriptionField({
  label = 'Description',
  value,
  onChange,
  help,
  error,
  disabled = false,
  placeholder,
  className,
  minHeightClassName,
}: RichDescriptionFieldProps) {
  const id = React.useId();
  const labelId = `${id}-label`;
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;

  return (
    <div className={className}>
      {/* The editor is a contenteditable, not a form control, so htmlFor cannot point at it.
          aria-labelledby on the editor is what gives it this label. */}
      <Label id={labelId} className="mb-2 block">
        {label}
      </Label>
      <RichDescriptionEditor
        showToolbar
        value={value}
        onChange={onChange}
        disabled={disabled}
        invalid={Boolean(error)}
        placeholder={placeholder}
        ariaLabelledBy={labelId}
        ariaDescribedBy={error ? errorId : help ? helpId : undefined}
        minHeightClassName={minHeightClassName}
        // The field's own label names the expanded view too, so an author who expands from a
        // problem dialog can still see which description they are editing.
        expandedTitle={label}
      />
      {help && !error && (
        <p id={helpId} className="text-muted-foreground mt-1 text-xs">
          {help}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-destructive mt-1 text-xs">
          {error}
        </p>
      )}
    </div>
  );
}

export default RichDescriptionField;
