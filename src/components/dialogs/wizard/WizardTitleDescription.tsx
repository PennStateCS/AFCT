'use client';

import React from 'react';
import { Label } from '@/components/ui/label';
import { RequiredMark } from '@/components/ui/required-mark';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { RichDescriptionField } from '@/components/rich-description/RichDescriptionField';
import type { RichDescriptionEnvelope } from '@/lib/rich-description';

type Props = {
  // Unique per dialog so ids don't collide if two are ever mounted at once.
  idPrefix: string;
  title: string;
  onTitleChange: (value: string) => void;
  description: string;
  onDescriptionChange: (value: string) => void;
  titleError?: string;
  titlePlaceholder?: string;
  descriptionPlaceholder?: string;
  // Optional explanatory text shown under the fields (e.g. "copied from the source").
  note?: React.ReactNode;
  /**
   * Opt in to the rich-description editor instead of the plain textarea. `value` seeds it (the
   * source's stored document, or its plain text for a legacy record) and `onChange` fires only
   * on a real edit. Callers that pass this still keep `description` as the plain-text value they
   * send when nothing was edited.
   */
  rich?: {
    value: RichDescriptionEnvelope | string | null;
    onChange: (value: RichDescriptionEnvelope) => void;
  };
};

/**
 * The Title + Description block shared by the duplicate/import dialogs: a labelled title
 * input with an inline error (wired via aria-invalid/aria-describedby and role="alert"),
 * a labelled description textarea, and optional helper note.
 */
export function WizardTitleDescription({
  idPrefix,
  title,
  onTitleChange,
  description,
  onDescriptionChange,
  titleError,
  titlePlaceholder,
  descriptionPlaceholder,
  note,
  rich,
}: Props) {
  const titleId = `${idPrefix}-title`;
  const titleErrorId = `${idPrefix}-title-error`;
  const descriptionId = `${idPrefix}-description`;

  return (
    <>
      <div>
        {/* The marker is a sibling of the label, matching `RequiredMark`'s own rule: the
            label's text stays the field name, so the control's accessible name does too, and
            `aria-required` below is what tells assistive tech it is required. Every caller of
            this block rejects an empty title and none of them said so. */}
        <div className="mb-2 flex items-center">
          <Label htmlFor={titleId}>Title</Label>
          <RequiredMark />
        </div>
        <Input
          id={titleId}
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          required
          aria-required="true"
          aria-invalid={!!titleError}
          aria-describedby={titleError ? titleErrorId : undefined}
          placeholder={titlePlaceholder}
        />
        {titleError && (
          <p id={titleErrorId} className="text-destructive mt-1 text-xs" role="alert">
            {titleError}
          </p>
        )}
      </div>
      {rich ? (
        <RichDescriptionField
          value={rich.value}
          onChange={rich.onChange}
          placeholder={descriptionPlaceholder}
          minHeightClassName="min-h-32"
        />
      ) : (
        <div>
          <Label htmlFor={descriptionId} className="mb-2 block">
            Description
          </Label>
          <Textarea
            id={descriptionId}
            value={description}
            onChange={(e) => onDescriptionChange(e.target.value)}
            placeholder={descriptionPlaceholder}
            className="min-h-[120px]"
          />
        </div>
      )}
      {note && <p className="text-muted-foreground text-xs">{note}</p>}
    </>
  );
}
