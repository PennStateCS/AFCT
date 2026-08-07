'use client';

import React, { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { WizardTitleDescription } from '@/components/dialogs/wizard/WizardTitleDescription';
import { showToast } from '@/lib/toast';
import { apiPaths } from '@/lib/api-paths';
import { apiClient, ApiError } from '@/lib/api/fetch-client';
import type { Problem } from '@prisma/client';
import { asRichDescription, type RichDescriptionEnvelope } from '@/lib/rich-description';

export type DuplicateSourceProblem = {
  id: string;
  title: string;
  description?: string | null;
  /** The source's stored rich description, so the copy keeps it. */
  descriptionJson?: unknown;
};

type Props = {
  open: boolean;
  setOpen: (open: boolean) => void;
  courseId: string;
  courseIsArchived: boolean;
  problem: DuplicateSourceProblem | null;
  onDuplicated?: (created: Problem) => void;
};

/**
 * Duplicate an existing problem. Mirrors the Details step of the Duplicate Assignment
 * wizard: only the title/description are editable; the type, state cap, determinism
 * flag, and the solution file are copied from the source and editable afterward.
 */
export function DuplicateProblemDialog({
  open,
  setOpen,
  courseId,
  courseIsArchived,
  problem,
  onDuplicated,
}: Props) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  // The copy's rich description: the source's document, replaced by whatever is edited here.
  // Null means the source was plain text and untouched, so the copy stays plain text.
  const [descriptionJson, setDescriptionJson] = useState<RichDescriptionEnvelope | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Prefill from the source whenever the dialog opens (or targets a different problem).
  useEffect(() => {
    if (open && problem) {
      setTitle(problem.title);
      setDescription(problem.description ?? '');
      setDescriptionJson(asRichDescription(problem.descriptionJson));
      setSubmitting(false);
    }
  }, [open, problem]);

  const titleError = title.trim().length < 3 ? 'Title must be at least 3 characters.' : undefined;

  const handleCreate = async () => {
    if (!problem || titleError) return;
    setSubmitting(true);
    try {
      const created = await apiClient.post<Problem>(
        apiPaths.courseProblemDuplicate(courseId, problem.id),
        {
          title: title.trim(),
          // Rich JSON wins and the server derives the plain text from it, so a rich original
          // stays rich in the copy. Falls back to the plain text for a legacy original.
          ...(descriptionJson
            ? { descriptionJson }
            : { description: description.trim() ? description.trim() : null }),
        },
      );
      showToast.duplicated('Problem', { name: problem?.title });
      onDuplicated?.(created);
      setOpen(false);
    } catch (err) {
      showToast.error(err instanceof ApiError ? err.message : 'Failed to duplicate problem');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Duplicate Problem</DialogTitle>
          <DialogDescription className="sr-only">
            Duplicate this problem: edit its title and description, then create the copy.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <WizardTitleDescription
            // Remount per source so the editor reloads its initial content.
            key={problem?.id ?? 'none'}
            idPrefix="dup-problem"
            title={title}
            onTitleChange={setTitle}
            description={description}
            onDescriptionChange={setDescription}
            titleError={titleError}
            titlePlaceholder="Problem title"
            descriptionPlaceholder="Enter problem description"
            // Seeded straight from the source rather than from state: the editor takes its
            // value as initial content only, and the prefill effect runs after it mounts.
            rich={{
              value: asRichDescription(problem?.descriptionJson) ?? problem?.description ?? '',
              onChange: setDescriptionJson,
            }}
            note="The solution file and the other settings (type, state limit, and determinism) are copied from the original. You can edit the remaining details after the copy is created."
          />
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="ghost">
              Cancel
            </Button>
          </DialogClose>
          <Button
            type="button"
            onClick={handleCreate}
            disabled={submitting || courseIsArchived || !!titleError}
          >
            {submitting ? 'Duplicating…' : 'Create Duplicate'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
