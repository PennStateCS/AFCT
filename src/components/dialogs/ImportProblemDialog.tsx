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
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import SelectField from '@/components/ui/SelectField';
import { Stepper } from '@/components/ui/stepper';
import { showToast } from '@/lib/toast';
import { apiPaths } from '@/lib/api-paths';
import { apiClient, ApiError } from '@/lib/api/fetch-client';
import type { Problem } from '@prisma/client';

const STEP_TITLES = ['Source', 'Details', 'Review'] as const;
const LAST_STEP = STEP_TITLES.length - 1;

type ManageableCourse = {
  id: string;
  name: string;
  code: string | null;
  semester: string | null;
  isArchived: boolean;
};

type SourceProblem = {
  id: string;
  title: string;
  description?: string | null;
  type?: string | null;
};

type Props = {
  open: boolean;
  setOpen: (open: boolean) => void;
  courseId: string;
  courseIsArchived: boolean;
  onImported?: (created: Problem) => void;
};

/** "Theory (CS 301) · Spring 2026 · Archived" style label for a source course. */
function courseLabel(c: ManageableCourse): string {
  let label = c.name;
  if (c.code) label += ` (${c.code})`;
  if (c.semester) label += ` · ${c.semester}`;
  if (c.isArchived) label += ' · Archived';
  return label;
}

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

  const [courses, setCourses] = useState<ManageableCourse[]>([]);
  const [coursesLoading, setCoursesLoading] = useState(false);
  const [sourceCourseId, setSourceCourseId] = useState('');

  const [problems, setProblems] = useState<SourceProblem[]>([]);
  const [problemsLoading, setProblemsLoading] = useState(false);
  const [sourceProblemId, setSourceProblemId] = useState('');

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Reset and load the manageable-course list each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setStep(0);
    setSourceCourseId('');
    setProblems([]);
    setSourceProblemId('');
    setTitle('');
    setDescription('');
    setSubmitting(false);

    let cancelled = false;
    setCoursesLoading(true);
    void (async () => {
      try {
        const list = await apiClient.get<ManageableCourse[]>(
          apiPaths.myManageableCourses({ excludeCourseId: courseId }),
        );
        if (!cancelled) setCourses(list);
      } catch {
        if (!cancelled) showToast.error('Failed to load courses');
      } finally {
        if (!cancelled) setCoursesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, courseId]);

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
        if (!cancelled) showToast.error('Failed to load problems');
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
        description: description.trim() ? description.trim() : null,
      });
      showToast.success('Problem imported');
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
      <DialogContent className="bg-card sm:max-w-2xl" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Import Problem</DialogTitle>
          <DialogDescription className="sr-only">
            Import a problem from another course you manage: pick the source, edit the details, then
            review.
          </DialogDescription>
        </DialogHeader>

        <Stepper
          steps={STEP_TITLES as unknown as string[]}
          current={step}
          onStepClick={(index) => setStep(index)}
          className="mb-2"
        />
        <div className="sr-only" role="status" aria-live="polite">
          {`Step ${step + 1} of ${STEP_TITLES.length}: ${STEP_TITLES[step]}`}
        </div>

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
            <>
              <div>
                <Label htmlFor="import-problem-title" className="mb-2 block">
                  Title
                </Label>
                <Input
                  id="import-problem-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  aria-invalid={!!titleError}
                  aria-describedby={titleError ? 'import-problem-title-error' : undefined}
                  placeholder="Problem title"
                />
                {titleError && (
                  <p
                    id="import-problem-title-error"
                    className="mt-1 text-xs text-red-600"
                    role="alert"
                  >
                    {titleError}
                  </p>
                )}
              </div>
              <div>
                <Label htmlFor="import-problem-description" className="mb-2 block">
                  Description
                </Label>
                <Textarea
                  id="import-problem-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Enter problem description"
                  className="min-h-[120px]"
                />
              </div>
              <p className="text-muted-foreground text-xs">
                The title and description start as the source problem&apos;s. The type, state limit,
                determinism, and the solution file are copied from the source; you can edit the
                remaining details after the copy is created.
              </p>
            </>
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
