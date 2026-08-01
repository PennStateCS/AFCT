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
import { WizardSteps } from '@/components/dialogs/wizard/WizardSteps';
import { WizardTitleDescription } from '@/components/dialogs/wizard/WizardTitleDescription';
import { showToast } from '@/lib/toast';
import { apiPaths } from '@/lib/api-paths';
import { apiClient, ApiError } from '@/lib/api/fetch-client';
import type { Assignment } from '@prisma/client';
import type { AssignmentProblemDuplicateMode } from '@/schemas/assignment';
import { asRichDescription, type RichDescriptionEnvelope } from '@/lib/rich-description';

const STEP_TITLES = ['Details', 'Problems', 'Review'] as const;
const LAST_STEP = STEP_TITLES.length - 1;

export type DuplicateSourceAssignment = {
  id: string;
  title: string;
  description?: string | null;
  /** The source's stored rich description, so the copy keeps it. */
  descriptionJson?: unknown;
  isGroup?: boolean;
  problemCount?: number;
};

type Props = {
  open: boolean;
  setOpen: (open: boolean) => void;
  courseId: string;
  courseIsArchived: boolean;
  assignment: DuplicateSourceAssignment | null;
  onDuplicated?: (created: Assignment) => void;
};

const PROBLEM_OPTIONS: {
  value: AssignmentProblemDuplicateMode;
  label: string;
  desc: string;
}[] = [
  {
    value: 'none',
    label: "Don't include problems",
    desc: 'The copy starts with no problems. You can add problems to it afterward.',
  },
  {
    value: 'link',
    label: 'Link the same problems',
    desc: 'Both assignments point at the same problems. Editing a problem, including its solution file, changes it in both assignments.',
  },
  {
    value: 'duplicate',
    label: 'Duplicate the problems',
    desc: 'Independent copies are made in this course, each with its own solution file. Editing a problem in one assignment does not affect the other.',
  },
];

/**
 * Duplicate an existing assignment. Modeled on the Create Assignment wizard but shorter:
 * the type and Assign To settings are copied from the source (not chosen here), so the
 * only inputs are the title/description and how to handle the source's problems.
 */
export function DuplicateAssignmentDialog({
  open,
  setOpen,
  courseId,
  courseIsArchived,
  assignment,
  onDuplicated,
}: Props) {
  const [step, setStep] = useState(0);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  // The copy's rich description: the source's document when it has one, replaced by whatever
  // the author edits here. Null means the source was plain text and was left alone, so the copy
  // stays plain text too.
  const [descriptionJson, setDescriptionJson] = useState<RichDescriptionEnvelope | null>(null);
  const [problemMode, setProblemMode] = useState<AssignmentProblemDuplicateMode>('duplicate');
  const [submitting, setSubmitting] = useState(false);

  // Prefill from the source whenever the dialog opens (or targets a different assignment).
  useEffect(() => {
    if (open && assignment) {
      setStep(0);
      setTitle(assignment.title);
      setDescription(assignment.description ?? '');
      setDescriptionJson(asRichDescription(assignment.descriptionJson));
      setProblemMode('duplicate');
      setSubmitting(false);
    }
  }, [open, assignment]);

  const hasProblems = (assignment?.problemCount ?? 0) > 0;
  const titleError = title.trim().length === 0 ? 'A title is required.' : undefined;

  const next = () => {
    if (step === 0 && titleError) return;
    setStep((s) => Math.min(s + 1, LAST_STEP));
  };
  const back = () => setStep((s) => Math.max(s - 1, 0));

  const handleCreate = async () => {
    if (!assignment || titleError) return;
    setSubmitting(true);
    try {
      const created = await apiClient.post<Assignment>(
        apiPaths.assignmentDuplicate(courseId, assignment.id),
        {
          title: title.trim(),
          // Rich JSON wins and the server derives the plain text from it, so a rich original
          // stays rich in the copy. Falls back to the plain text for a legacy original.
          ...(descriptionJson
            ? { descriptionJson }
            : { description: description.trim() ? description.trim() : null }),
          // With no problems there's nothing to copy, so the mode is moot; send 'none'.
          problemMode: hasProblems ? problemMode : 'none',
        },
      );
      showToast.success('Assignment duplicated');
      onDuplicated?.(created);
      setOpen(false);
    } catch (err) {
      showToast.error(err instanceof ApiError ? err.message : 'Failed to duplicate assignment');
    } finally {
      setSubmitting(false);
    }
  };

  const problemSummary = !hasProblems
    ? 'No problems to copy'
    : problemMode === 'none'
      ? 'Not included'
      : problemMode === 'link'
        ? 'Linked (shared with the original)'
        : 'Duplicated (independent copies)';

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-2xl" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Duplicate Assignment</DialogTitle>
          <DialogDescription className="sr-only">
            Duplicate this assignment in three steps: details, how to handle its problems, then
            review.
          </DialogDescription>
        </DialogHeader>

        <WizardSteps
          steps={STEP_TITLES}
          current={step}
          onStepClick={(index) => setStep(index)}
          className="mb-2"
        />

        <div className="min-h-[320px] space-y-4">
          {step === 0 && (
            <WizardTitleDescription
              // Remount per source so the editor reloads its initial content.
              key={assignment?.id ?? 'none'}
              idPrefix="dup"
              title={title}
              onTitleChange={setTitle}
              description={description}
              onDescriptionChange={setDescription}
              titleError={titleError}
              titlePlaceholder="Assignment title"
              descriptionPlaceholder="Enter assignment description"
              // Seeded straight from the source rather than from state: the editor takes its
              // value as initial content only, and the prefill effect runs after it mounts.
              rich={{
                value: asRichDescription(assignment?.descriptionJson) ?? assignment?.description ?? '',
                onChange: setDescriptionJson,
              }}
              note="The title and description start as the original's. Edit them here or leave them unchanged. The assignment type and the Assign To settings (audience, dates, and any exceptions) are copied from the original and can be changed after the copy is created."
            />
          )}

          {step === 1 && (
            <fieldset className="space-y-3">
              <legend className="text-sm font-medium">Problems</legend>
              {!hasProblems ? (
                <p className="text-muted-foreground text-sm">
                  This assignment has no problems, so there is nothing to copy. The duplicate will
                  start empty.
                </p>
              ) : (
                <div className="grid gap-3">
                  {PROBLEM_OPTIONS.map((opt) => {
                    const selected = problemMode === opt.value;
                    return (
                      <label
                        key={opt.value}
                        className={`flex cursor-pointer gap-3 rounded-lg border p-4 transition ${
                          selected
                            ? 'border-primary bg-primary/5 ring-primary/30 ring-1'
                            : 'hover:bg-muted'
                        }`}
                      >
                        <input
                          type="radio"
                          name="problemMode"
                          className="accent-primary mt-1"
                          checked={selected}
                          onChange={() => setProblemMode(opt.value)}
                        />
                        <span>
                          <span className="block text-sm font-medium">{opt.label}</span>
                          <span className="text-muted-foreground block text-xs">{opt.desc}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </fieldset>
          )}

          {step === LAST_STEP && (
            <div className="space-y-3">
              <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm [&>dd]:min-w-0 [&>dd]:break-words">
                <dt className="text-muted-foreground">Title</dt>
                <dd className="font-medium">{title.trim() || '(untitled)'}</dd>
                <dt className="text-muted-foreground">Type</dt>
                <dd>
                  {assignment?.isGroup ? 'Group' : 'Individual'}{' '}
                  <span className="text-muted-foreground">(copied from the original)</span>
                </dd>
                <dt className="text-muted-foreground">Assign To</dt>
                <dd>Copied from the original</dd>
                <dt className="text-muted-foreground">Problems</dt>
                <dd>{problemSummary}</dd>
              </dl>
              <p className="text-muted-foreground text-xs">
                The copy is created <strong>unpublished</strong>, regardless of whether the original
                is published. Submissions and grades are not copied. You can edit the type and
                Assign To settings after it is created.
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="ghost">
              Cancel
            </Button>
          </DialogClose>
          {step > 0 && (
            <Button type="button" variant="secondary" onClick={back}>
              Back
            </Button>
          )}
          {step < LAST_STEP ? (
            <Button type="button" onClick={next} disabled={step === 0 && !!titleError}>
              Next
            </Button>
          ) : (
            <Button
              type="button"
              onClick={handleCreate}
              disabled={submitting || courseIsArchived || !!titleError}
            >
              {submitting ? 'Duplicating…' : 'Create Duplicate'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
