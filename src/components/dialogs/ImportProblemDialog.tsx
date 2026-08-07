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
import type { Problem } from '@prisma/client';
import { asRichDescription, type RichDescriptionEnvelope } from '@/lib/rich-description';

const STEP_TITLES = ['Source', 'Details', 'Review'] as const;
const LAST_STEP = STEP_TITLES.length - 1;

type SourceProblem = {
  id: string;
  title: string;
  description?: string | null;
  /** The source's stored rich description, so the import keeps it. */
  descriptionJson?: unknown;
  type?: string | null;
};

type Props = {
  open: boolean;
  setOpen: (open: boolean) => void;
  courseId: string;
  courseIsArchived: boolean;
  onImported?: (created: Problem) => void;
};

/**
 * Import a problem from another course the user can manage into this course. Mirrors the
 * Import Assignment wizard: pick a source course and problem, edit the title/description,
 * then review. The type, state cap, determinism flag, and the solution file are copied
 * from the source into a fresh file in this course.
 */
export function ImportProblemDialog({
  open,
  setOpen,
  courseId,
  courseIsArchived,
  onImported,
}: Props) {
  const [step, setStep] = useState(0);

  const { courses, loading: coursesLoading } = useManageableCourses(open, courseId);
  const [sourceCourseId, setSourceCourseId] = useState('');

  const [problems, setProblems] = useState<SourceProblem[]>([]);
  const [problemsLoading, setProblemsLoading] = useState(false);
  const [sourceProblemId, setSourceProblemId] = useState('');

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  // The import's rich description: the source's document, replaced by whatever is edited here.
  // Null means the source was plain text and untouched, so the import stays plain text.
  const [descriptionJson, setDescriptionJson] = useState<RichDescriptionEnvelope | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Reset the wizard's own state each time it opens (the course list is loaded by the hook).
  useEffect(() => {
    if (!open) return;
    setStep(0);
    setSourceCourseId('');
    setProblems([]);
    setSourceProblemId('');
    setTitle('');
    setDescription('');
    setDescriptionJson(null);
    setSubmitting(false);
  }, [open]);

  // When the source course changes, load its problems and clear the selection.
  useEffect(() => {
    if (!open || !sourceCourseId) return;
    let cancelled = false;
    setProblemsLoading(true);
    setProblems([]);
    setSourceProblemId('');
    void (async () => {
      try {
        const list = await apiClient.get<SourceProblem[]>(apiPaths.courseProblems(sourceCourseId));
        if (!cancelled) setProblems(list);
      } catch {
        if (!cancelled)
          showToast.error(
            'Could not load problems to import from. Close and reopen this dialog to try again.',
          );
      } finally {
        if (!cancelled) setProblemsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, sourceCourseId]);

  const selected = problems.find((p) => p.id === sourceProblemId) ?? null;

  // Prefill the title/description from the chosen source problem.
  useEffect(() => {
    if (selected) {
      setTitle(selected.title);
      setDescription(selected.description ?? '');
      setDescriptionJson(asRichDescription(selected.descriptionJson));
    }
  }, [selected]);

  const titleError = title.trim().length < 3 ? 'Title must be at least 3 characters.' : undefined;
  const sourceComplete = Boolean(sourceCourseId && sourceProblemId);

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
      const created = await apiClient.post<Problem>(apiPaths.courseProblemImport(courseId), {
        sourceCourseId,
        sourceProblemId,
        title: title.trim(),
        // Rich JSON wins and the server derives the plain text from it, so a rich source stays
        // rich in the import. Falls back to the plain text for a legacy source.
        ...(descriptionJson
          ? { descriptionJson }
          : { description: description.trim() ? description.trim() : null }),
      });
      showToast.imported('Problem');
      onImported?.(created);
      setOpen(false);
    } catch (err) {
      showToast.error(err instanceof ApiError ? err.message : 'Failed to import problem');
    } finally {
      setSubmitting(false);
    }
  };

  const sourceCourse = courses.find((c) => c.id === sourceCourseId) ?? null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-2xl" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Import Problem</DialogTitle>
          <DialogDescription className="sr-only">
            Import a problem from another course you manage: pick the source, edit the details, then
            review.
          </DialogDescription>
        </DialogHeader>

        <WizardSteps
          steps={STEP_TITLES}
          current={step}
          onStepClick={(index) => setStep(index)}
          className="mb-2"
        />

        <div className="min-h-[300px] space-y-4">
          {step === 0 && (
            <div className="space-y-4">
              <SelectField
                label="Course to import from"
                name="import-problem-source-course"
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
                  label="Problem to import"
                  name="import-problem-source-problem"
                  requiredMark
                  truncateOptions={false}
                  value={sourceProblemId || undefined}
                  onValueChange={setSourceProblemId}
                  disabled={problemsLoading}
                  placeholder={problemsLoading ? 'Loading problems…' : 'Select a problem'}
                  options={problems.map((p) => ({
                    value: p.id,
                    label: `${p.title}${p.type ? ` (${p.type})` : ''}`,
                  }))}
                />
              )}
              {sourceCourseId && !problemsLoading && problems.length === 0 && (
                <p className="text-muted-foreground text-sm">
                  That course has no problems to import.
                </p>
              )}
            </div>
          )}

          {step === 1 && (
            <WizardTitleDescription
              // Remount per source so the editor reloads its initial content.
              key={sourceProblemId || 'none'}
              idPrefix="import-problem"
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
                value: asRichDescription(selected?.descriptionJson) ?? selected?.description ?? '',
                onChange: setDescriptionJson,
              }}
              note="The title and description start as the source problem's. The type, state limit, determinism, and the solution file are copied from the source; you can edit the remaining details after the copy is created."
            />
          )}

          {step === LAST_STEP && (
            <div className="space-y-3">
              <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm [&>dd]:min-w-0 [&>dd]:break-words">
                <dt className="text-muted-foreground">From course</dt>
                <dd className="font-medium">{sourceCourse ? courseLabel(sourceCourse) : '—'}</dd>
                <dt className="text-muted-foreground">Problem</dt>
                <dd>{selected?.title ?? '—'}</dd>
                <dt className="text-muted-foreground">Type</dt>
                <dd>
                  {selected?.type ?? '—'}{' '}
                  <span className="text-muted-foreground">(copied from the source)</span>
                </dd>
                <dt className="text-muted-foreground">Title</dt>
                <dd className="font-medium">{title.trim() || '(untitled)'}</dd>
              </dl>
              <p className="text-muted-foreground text-xs">
                A copy is created in this course with its own solution file. The original in the
                other course is not affected.
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
              {submitting ? 'Importing…' : 'Import Problem'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
