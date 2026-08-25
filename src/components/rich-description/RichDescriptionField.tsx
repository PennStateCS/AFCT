'use client';

import * as React from 'react';
import dynamic from 'next/dynamic';

import { cn } from '@/lib/utils';
import { Label } from '@/components/ui/label';
import type { RichDescriptionEnvelope } from '@/lib/rich-description';

/**
 * The editor is fetched when a form that uses it is actually shown, not with the page.
 *
 * It is the heaviest thing in the app's client bundle by a wide margin: ProseMirror, Tiptap, and
 * KaTeX (the Tiptap maths extension imports KaTeX outright, so there is no separating them).
 * Statically imported, all of that landed on the course and assignment routes, which is where
 * STUDENTS spend their time, to serve a form only staff ever open.
 *
 * `ssr: false` because there is nothing useful to render server-side: it is a contenteditable
 * that only exists once ProseMirror runs. This is the one place in the app that loads a component
 * this way; every description form goes through this field, so it is the only place that needs to.
 */
const RichDescriptionEditor = dynamic(
  () => import('./RichDescriptionEditor').then((module) => module.RichDescriptionEditor),
  {
    ssr: false,
    // An empty box in the editor's own colours, stretched by the wrapper below to the height the
    // caller asked for, so the form does not collapse and then jump. Not announced: the field's
    // label already says what is coming, and "loading" on a control that is about to become
    // editable is noise. It is still a little shorter than the real editor, which adds a toolbar
    // row on top of that height.
    loading: () => (
      <div
        aria-hidden="true"
        className="border-input bg-card size-full rounded-md border shadow-xs"
      />
    ),
  },
);

export type RichDescriptionFieldProps = {
  /** Visible label. Also the editor's accessible name. */
  label?: string;
  /**
   * Initial value: a stored envelope, or a plain string for a legacy record (converted through
   * the shared utility). Treated as initial content only, like the editor itself.
   */
  value?: RichDescriptionEnvelope | string | null;
  onChange: (value: RichDescriptionEnvelope) => void;
  /** The document as loaded, once, before any edit. See the editor prop of the same name. */
  onDocumentReady?: (value: RichDescriptionEnvelope) => void;
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
  onDocumentReady,
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
      {/* Reserves the requested height for the placeholder, which cannot see these props. Once
          the editor arrives it carries its own min-height, and this wrapper must NOT stretch it:
          a grid item forced to the row height cannot then be resized by the drag grip. */}
      <div className={cn('flex flex-col', minHeightClassName)}>
        <RichDescriptionEditor
          showToolbar
          value={value}
          onChange={onChange}
          onDocumentReady={onDocumentReady}
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
      </div>
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
