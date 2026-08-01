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
import SelectField from '@/components/ui/SelectField';
import { WizardSteps } from '@/components/dialogs/wizard/WizardSteps';
import { WizardTitleDescription } from '@/components/dialogs/wizard/WizardTitleDescription';
import { showToast } from '@/lib/toast';
import { apiPaths } from '@/lib/api-paths';
import { apiClient, ApiError } from '@/lib/api/fetch-client';
import { useManageableCourses, courseLabel } from '@/hooks/use-manageable-courses';
import type { Assignment } from '@prisma/client';
import type { AssignmentImportProblemMode } from '@/schemas/assignment';
import { asRichDescription, type RichDescriptionEnvelope } from '@/lib/rich-description';

const STEP_TITLES = ['Source', 'Details', 'Problems', 'Review'] as const;
const LAST_STEP = STEP_TITLES.length - 1;

type SourceAssignment = {
  id: string;
  title: string;
  description?: string | null;
  /** The source's stored rich description, so the import keeps it. */
  descriptionJson?: unknown;
  problemCount?: number;
  isGroup?: boolean;
};

type Props = {
  open: boolean;
  setOpen: (open: boolean) => void;
  courseId: string;
  courseIsArchived: boolean;
  onImported?: (created: Assignment) => void;
};

/**
 * Import an assignment from another course the user can manage into this course. Modeled
 * on the Duplicate Assignment wizard, but the source is a different course: audience,
 * group set, and date exceptions are not carried across, so the import always lands
 * unpublished, individual, and assigned to everyone. Problems are either copied into this
 * course or omitted (there is no "link" option across courses).
 */
export function ImportAssignmentDialog({
  open,
  setOpen,
  courseId,
  courseIsArchived,
  onImported,
}: Props) {
  const [step, setStep] = useState(0);

  const { courses, loading: coursesLoading } = useManageableCourses(open, courseId);
  const [sourceCourseId, setSourceCourseId] = useState('');

  const [assignments, setAssignments] = useState<SourceAssignment[]>([]);
  const [assignmentsLoading, setAssignmentsLoading] = useState(false);
  const [sourceAssignmentId, setSourceAssignmentId] = useState('');

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  // The import's rich description: the source's document, replaced by whatever is edited here.
  // Null means the source was plain text and untouched, so the import stays plain text.
  const [descriptionJson, setDescriptionJson] = useState<RichDescriptionEnvelope | null>(null);
  const [problemMode, setProblemMode] = useState<AssignmentImportProblemMode>('copy');
  const [submitting, setSubmitting] = useState(false);

  // Reset the wizard's own state each time it opens (the course list is loaded by the hook).
  useEffect(() => {
    if (!open) return;
    setStep(0);
    setSourceCourseId('');
    setAssignments([]);
    setSourceAssignmentId('');
    setTitle('');
    setDescription('');
    setDescriptionJson(null);
    setProblemMode('copy');
    setSubmitting(false);
  }, [open]);

  // When the source course changes, load its assignments (drafts included) and clear the
  // downstream selection.
  useEffect(() => {
    if (!open || !sourceCourseId) return;
    let cancelled = false;
    setAssignmentsLoading(true);
    setAssignments([]);
    setSourceAssignmentId('');
    void (async () => {
      try {
        const list = await apiClient.get<SourceAssignment[]>(
          apiPaths.courseAssignments(sourceCourseId, { includeUnpublished: true }),
        );
        if (!cancelled) setAssignments(list);
      } catch {
        if (!cancelled)
          showToast.error(
            'Could not load assignments to import from. Close and reopen this dialog to try again.',
          );
      } finally {
        if (!cancelled) setAssignmentsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, sourceCourseId]);

  const selected = assignments.find((a) => a.id === sourceAssignmentId) ?? null;

  // Prefill the title/description from the chosen source assignment.
  useEffect(() => {
    if (selected) {
      setTitle(selected.title);
      setDescription(selected.description ?? '');
      setDescriptionJson(asRichDescription(selected.descriptionJson));
    }
  }, [selected]);

  const hasProblems = (selected?.problemCount ?? 0) > 0;
  const sourceIsGroup = Boolean(selected?.isGroup);
  const titleError = title.trim().length === 0 ? 'A title is required.' : undefined;

  // Shown whenever the source is a group assignment: the import can't carry the group set
  // (groups are course-specific), so it lands as individual.
  const groupNote = sourceIsGroup
    ? 'The source is a group assignment. It will be imported as an individual assignment because groups are specific to each course. Set it up as a group assignment here after importing.'
    : null;
  const sourceComplete = Boolean(sourceCourseId && sourceAssignmentId);

  const next = () => {
    if (step === 0 && !sourceComplete) return;
    if (step === 1 && titleError) return;
    setStep((s) => Math.min(s + 1, LAST_STEP));
  };
  const back = () => setStep((s) => Math.max(s - 1, 0));

  const handleImport = async () => {
    if (!sourceComplete || titleError) return;
    setSubmitting(true);
    try {
      const created = await apiClient.post<Assignment>(apiPaths.assignmentImport(courseId), {
        sourceCourseId,
        sourceAssignmentId,
        title: title.trim(),
        // Rich JSON wins and the server derives the plain text from it, so a rich source stays
        // rich in the import. Falls back to the plain text for a legacy source.
        ...(descriptionJson
          ? { descriptionJson }
          : { description: description.trim() ? description.trim() : null }),
        // With no problems there is nothing to copy, so the mode is moot; send 'none'.
        problemMode: hasProblems ? problemMode : 'none',
      });
      showToast.imported('Assignment');
      onImported?.(created);
      setOpen(false);
    } catch (err) {
      showToast.error(err instanceof ApiError ? err.message : 'Failed to import assignment');
    } finally {
      setSubmitting(false);
    }
  };

  const sourceCourse = courses.find((c) => c.id === sourceCourseId) ?? null;
  const problemSummary = !hasProblems
    ? 'No problems to copy'
    : problemMode === 'copy'
      ? 'Copied into this course (independent copies)'
      : 'Not included';

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-2xl" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Import Assignment</DialogTitle>
          <DialogDescription className="sr-only">
            Import an assignment from another course you manage: pick the source, edit the details,
            choose how to handle problems, then review.
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
            <div className="space-y-4">
              <SelectField
                label="Course to import from"
                name="import-source-course"
                requiredMark
                truncateOptions={false}
                value={sourceCourseId || undefined}
                onValueChange={setSourceCourseId}
                disabled={coursesLoading}
                placeholder={coursesLoading ? 'Loading courses…' : 'Select a course'}
                options={courses.map((c) => ({ value: c.id, label: courseLabel(c) }))}
              />
              {!coursesLoading && courses.length === 0 && (
                <p className="text-muted-foreground text-sm">
                  You do not manage any other courses to import from.
                </p>
              )}

              {sourceCourseId && (
                <SelectField
                  label="Assignment to import"
                  name="import-source-assignment"
                  requiredMark
                  truncateOptions={false}
                  value={sourceAssignmentId || undefined}
                  onValueChange={setSourceAssignmentId}
                  disabled={assignmentsLoading}
                  placeholder={assignmentsLoading ? 'Loading assignments…' : 'Select an assignment'}
                  options={assignments.map((a) => ({
                    value: a.id,
                    label: `${a.title}${a.isGroup ? ' (Group)' : ''}${(a.problemCount ?? 0) > 0 ? ` · ${a.problemCount} problem${a.problemCount === 1 ? '' : 's'}` : ''}`,
                  }))}
                />
              )}
              {sourceCourseId && !assignmentsLoading && assignments.length === 0 && (
                <p className="text-muted-foreground text-sm">
                  That course has no assignments to import.
                </p>
              )}
            </div>
          )}

          {step === 1 && (
            <WizardTitleDescription
              // Remount per source so the editor reloads its initial content.
              key={sourceAssignmentId || 'none'}
              idPrefix="import-assignment"
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
                value: asRichDescription(selected?.descriptionJson) ?? selected?.description ?? '',
                onChange: setDescriptionJson,
              }}
              note={
                <>
                  The title and description start as the source assignment&apos;s. The imported copy
                  is assigned to <strong>all students</strong> and created as an individual
                  assignment; you can change the audience and type after it is created.
                  {groupNote && (
                    <span
                      role="note"
                      className="border-status-warning-border bg-status-warning-bg text-status-warning mt-2 block rounded-md border p-2"
                    >
                      {groupNote}
                    </span>
                  )}
                </>
              }
            />
          )}

          {step === 2 && (
            <fieldset className="space-y-3">
              <legend className="text-sm font-medium">Problems</legend>
              {!hasProblems ? (
                <p className="text-muted-foreground text-sm">
                  This assignment has no problems, so there is nothing to copy. The import will
                  start empty.
                </p>
              ) : (
                <div className="grid gap-3">
                  {[
                    {
                      value: 'copy' as const,
                      label: 'Copy the problems into this course',
                      desc: 'Each problem is copied into this course, with its own solution file. The originals in the other course are not affected.',
                    },
                    {
                      value: 'none' as const,
                      label: "Don't include problems",
                      desc: 'The imported assignment starts with no problems. You can add problems to it afterward.',
                    },
                  ].map((opt) => {
                    const isSelected = problemMode === opt.value;
                    return (
                      <label
                        key={opt.value}
                        className={`flex cursor-pointer gap-3 rounded-lg border p-4 transition ${
                          isSelected
                            ? 'border-primary bg-primary/5 ring-primary/30 ring-1'
                            : 'hover:bg-muted'
                        }`}
                      >
                        <input
                          type="radio"
                          name="importProblemMode"
                          className="accent-primary mt-1"
                          checked={isSelected}
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
                <dt className="text-muted-foreground">From course</dt>
                <dd className="font-medium">{sourceCourse ? courseLabel(sourceCourse) : '—'}</dd>
                <dt className="text-muted-foreground">Assignment</dt>
                <dd>{selected?.title ?? '—'}</dd>
                <dt className="text-muted-foreground">Title</dt>
                <dd className="font-medium">{title.trim() || '(untitled)'}</dd>
                <dt className="text-muted-foreground">Assign To</dt>
                <dd>All students{sourceIsGroup ? ' (individual; was a group assignment)' : ''}</dd>
                <dt className="text-muted-foreground">Problems</dt>
                <dd>{problemSummary}</dd>
              </dl>
              {groupNote && (
                <p
                  role="note"
                  className="border-status-warning-border bg-status-warning-bg text-status-warning rounded-md border p-2 text-xs"
                >
                  {groupNote}
                </p>
              )}
              <p className="text-muted-foreground text-xs">
                The assignment is imported <strong>unpublished</strong> and assigned to everyone.
                Its schedule (due date, available-from, and late settings) is copied from the source
                and may be from another term, so review the dates before publishing. Submissions and
                grades are not imported.
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
            <Button
              type="button"
              onClick={next}
              disabled={(step === 0 && !sourceComplete) || (step === 1 && !!titleError)}
            >
              Next
            </Button>
          ) : (
            <Button
              type="button"
              onClick={handleImport}
              disabled={submitting || courseIsArchived || !sourceComplete || !!titleError}
            >
              {submitting ? 'Importing…' : 'Import Assignment'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
