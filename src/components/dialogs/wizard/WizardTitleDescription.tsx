'use client';

import React from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

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
}: Props) {
  const titleId = `${idPrefix}-title`;
  const titleErrorId = `${idPrefix}-title-error`;
  const descriptionId = `${idPrefix}-description`;

  return (
    <>
      <div>
        <Label htmlFor={titleId} className="mb-2 block">
          Title
        </Label>
        <Input
          id={titleId}
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          aria-invalid={!!titleError}
          aria-describedby={titleError ? titleErrorId : undefined}
          placeholder={titlePlaceholder}
        />
        {titleError && (
          <p id={titleErrorId} className="mt-1 text-xs text-destructive" role="alert">
            {titleError}
          </p>
        )}
      </div>
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
      {note && <p className="text-muted-foreground text-xs">{note}</p>}
    </>
  );
}
