'use client';

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
import { Textarea } from '@/components/ui/textarea';
import InputGroup from '@/components/ui/InputGroup';
import SwitchField from '@/components/ui/SwitchField';
import { LimitField } from '@/components/ui/LimitField';
import { Stepper } from '@/components/ui/stepper';

import { useEffect, useMemo, useState } from 'react';
import { useForm, Controller, type FieldPath } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import type { Problem } from '@prisma/client';
import { ProblemFormSchema, UpdateProblemSchema, type ProblemFormRaw } from '@/schemas/problem';
import FileUploadInput from '@/components/FileUploadInput';
import { useMaxUploadSize } from '@/hooks/useMaxUploadSize';
import { showToast } from '@/lib/toast';
import { apiPaths } from '@/lib/api-paths';
import { apiClient, ApiError } from '@/lib/api/fetch-client';

type EditProblemDialogProps = {
  courseIsArchived: boolean;
  problem: Problem;
  open: boolean;
  setOpen: (open: boolean) => void;
  onSaved?: (updated?: Problem) => void;
};

// RHF state (matches the trimmed ProblemFormSchema input): the intrinsic problem
// definition only. Points / submissions / autograding are per-assignment and edited on
// the assignment's Problems tab (AssignmentProblemSettingsDialog), not here.
type FormValues = ProblemFormRaw;

const TYPE_LABELS: Record<string, string> = {
  FA: 'Finite Automaton',
  PDA: 'Push-Down Automaton',
  CFG: 'Context-Free Grammar',
  RE: 'Regular Expression',
};

const STEPS: ReadonlyArray<{ title: string; fields: FieldPath<FormValues>[] }> = [
  { title: 'Details', fields: ['title', 'description'] },
  { title: 'Type', fields: ['type', 'maxStates', 'isUnlimitedStates', 'isDeterministic'] },
  { title: 'Answer File', fields: ['file'] },
  { title: 'Review', fields: [] },
];
const LAST_STEP = STEPS.length - 1;

// A four-step wizard mirroring the create-problem wizard, for editing the bank problem
// definition (title, description, type, FA/PDA shape, answer file). The answer file is
// optional on edit (the current one is kept) unless the problem type changes.
export function EditProblemDialog({
  courseIsArchived,
  problem,
  open,
  setOpen,
  onSaved,
}: EditProblemDialogProps) {
  const [step, setStep] = useState(0);

  const defaults: FormValues = useMemo(
    () => ({
      title: problem.title ?? '',
      description: problem.description ?? '',
      type: (problem.type ?? 'FA') as FormValues['type'],
      isUnlimitedStates: problem.maxStates == null || problem.maxStates < 0,
      maxStates: problem.maxStates ?? undefined,
      isDeterministic:
        problem.type === 'FA'
          ? !!(problem as Problem & { isDeterministic?: boolean }).isDeterministic
          : false,
      file: undefined as File | undefined,
      courseId: problem.courseId,
    }),
    [problem],
  );

  const {
    control,
    handleSubmit,
    reset,
    watch,
    trigger,
    getValues,
    setValue,
    setError,
    clearErrors,
    formState: { errors, isSubmitting, isValid },
  } = useForm<FormValues>({
    resolver: zodResolver(ProblemFormSchema),
    defaultValues: defaults,
    mode: 'onChange',
    reValidateMode: 'onChange',
  });

  const type = watch('type');
  const isUnlimitedStates = watch('isUnlimitedStates');

  const { maxMb, loading: loadingMaxSize } = useMaxUploadSize();

  const resetForm = () => {
    setStep(0);
    reset(defaults, { keepDirty: false, keepTouched: false, keepErrors: false, keepValues: false });
  };

  // Re-seed from the problem each time the dialog opens.
  useEffect(() => {
    if (open) resetForm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaults]);

  const next = async () => {
    const ok = await trigger(STEPS[step]?.fields ?? []);
    if (ok) setStep((s) => Math.min(s + 1, LAST_STEP));
  };
  const back = () => setStep((s) => Math.max(s - 1, 0));

  const onSubmit = async (raw: FormValues) => {
    try {
      const parsed = ProblemFormSchema.parse(raw);
      const payload = UpdateProblemSchema.parse({ id: problem.id, ...parsed });

      // Changing the problem type requires a new solution file (the stored one no longer
      // matches). Send the user back to the file step so the message is visible.
      if (payload.type !== problem.type && !(payload.file instanceof File)) {
        setStep(2);
        setError('file', { type: 'manual', message: 'Upload a new solution file for the new type.' });
        return;
      }

      const formData = new FormData();
      formData.append('title', payload.title ?? '');
      formData.append('description', payload.description ?? '');
      formData.append('type', payload.type ?? '');
      formData.append('courseId', payload.courseId ?? '');

      if (payload.type === 'FA' || payload.type === 'PDA') {
        formData.append('maxStates', String(payload.isUnlimitedStates ? -1 : (payload.maxStates ?? 0)));
      }
      if (payload.type === 'FA') {
        formData.append('isDeterministic', String(!!payload.isDeterministic));
      }
      // Only send a file when the user picked a new one; otherwise the current file is kept.
      if (payload.file instanceof File) {
        formData.append('file', payload.file);
      }

      let updatedProblem: Problem | null = null;
      try {
        updatedProblem = await apiClient.putForm<Problem>(
          apiPaths.courseProblem(problem.courseId, problem.id),
          formData,
        );
      } catch (err) {
        if (err instanceof ApiError) {
          // A 4xx usually means the file failed validation; show it on the file step.
          if (err.status >= 400 && err.status < 500) {
            setStep(2);
            setError('file', { type: 'manual', message: err.message });
          } else {
            showToast.error(err.message);
          }
          return;
        }
        throw err;
      }

      showToast.success('Problem updated.');
      resetForm();
      onSaved?.(updatedProblem ?? undefined);
      setOpen(false);
    } catch (error) {
      console.error('Edit problem submission error:', error);
      if (typeof error === 'string') {
        setStep(2);
        setError('file', { type: 'manual', message: error });
        return;
      }
      if (error instanceof z.ZodError) {
        showToast.error('Please fix validation errors before saving.');
        return;
      }
      showToast.error('Failed to save problem changes.');
    }
  };

  const review = step === LAST_STEP ? getValues() : null;
  const currentFileName = problem.originalFileName ?? problem.fileName ?? null;

  return (
    <Dialog
      open={open}
      onOpenChange={(val) => {
        setOpen(val);
        if (!val) resetForm();
      }}
    >
      <DialogContent className="bg-card sm:max-w-2xl" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Edit Problem</DialogTitle>
          <DialogDescription className="sr-only">
            Edit the problem definition in four steps: details, type, answer file, then review.
          </DialogDescription>
        </DialogHeader>

        <Stepper
          steps={STEPS.map((s) => s.title)}
          current={step}
          onStepClick={(index) => setStep(index)}
          className="mb-2"
        />

        <div className="sr-only" role="status" aria-live="polite">
          {`Step ${step + 1} of ${STEPS.length}: ${STEPS[step]?.title ?? ''}`}
        </div>

        <form
          onSubmit={step === LAST_STEP ? handleSubmit(onSubmit) : (e) => e.preventDefault()}
          className="space-y-4"
          onKeyDown={(e) => {
            const el = e.target as HTMLElement;
            const isMultiline = el.tagName === 'TEXTAREA' || el.isContentEditable;
            if (e.key === 'Enter' && step < LAST_STEP && !isMultiline) {
              e.preventDefault();
              void next();
            }
          }}
        >
          <div className="min-h-[320px] space-y-4">
            {step === 0 && (
              <>
                <Controller
                  control={control}
                  name="title"
                  render={({ field }) => (
                    <InputGroup
                      label="Title"
                      name="title"
                      fieldProps={field}
                      error={errors.title?.message}
                      showStatus
                      isValid={!errors.title && !!field.value}
                    />
                  )}
                />
                <Controller
                  control={control}
                  name="description"
                  render={({ field }) => (
                    <div>
                      <Label htmlFor="edit-problem-description" className="mb-2 block">
                        Description
                      </Label>
                      <Textarea
                        {...field}
                        id="edit-problem-description"
                        value={field.value ?? ''}
                        rows={4}
                        placeholder="Optional description"
                        aria-invalid={errors.description ? true : undefined}
                        aria-describedby={
                          errors.description ? 'edit-problem-description-error' : undefined
                        }
                      />
                      {errors.description && (
                        <p
                          id="edit-problem-description-error"
                          role="alert"
                          className="mt-1 text-xs text-red-600"
                        >
                          {errors.description.message}
                        </p>
                      )}
                    </div>
                  )}
                />
              </>
            )}

            {step === 1 && (
              <>
                <Controller
                  control={control}
                  name="type"
                  render={({ field }) => (
                    <div>
                      <Label htmlFor="edit-problem-type" className="mb-2 block">
                        Problem Type
                      </Label>
                      <select
                        id="edit-problem-type"
                        className="bg-card w-full rounded border border-black p-2"
                        value={field.value ?? ''}
                        onChange={(e) => field.onChange(e.target.value as FormValues['type'])}
                      >
                        <option value="FA">Finite Automaton</option>
                        <option value="PDA">Push-Down Automaton</option>
                        <option value="CFG">Context-Free Grammar</option>
                        <option value="RE">Regular Expression</option>
                      </select>
                      {type !== problem.type && (
                        <p className="text-muted-foreground mt-1 text-xs">
                          Changing the type requires uploading a new answer file.
                        </p>
                      )}
                    </div>
                  )}
                />

                {(type === 'FA' || type === 'PDA') && (
                  <Controller
                    control={control}
                    name="maxStates"
                    render={({ field }) => (
                      <LimitField
                        label="Max States"
                        name="maxStates"
                        unlimited={!!isUnlimitedStates}
                        onUnlimitedChange={(unlimited) =>
                          setValue('isUnlimitedStates', unlimited, { shouldValidate: true })
                        }
                        value={
                          isUnlimitedStates
                            ? ''
                            : ((field.value as number | string | null | undefined) ?? '')
                        }
                        onValueChange={field.onChange}
                        onValueBlur={field.onBlur}
                        min={1}
                        max={1_000}
                        placeholder="e.g. 12"
                        error={errors.maxStates?.message}
                      />
                    )}
                  />
                )}

                {type === 'FA' && (
                  <Controller
                    control={control}
                    name="isDeterministic"
                    render={({ field }) => (
                      <SwitchField
                        label="Deterministic"
                        name="isDeterministic"
                        id="edit-isDeterministic"
                        checked={!!field.value}
                        onCheckedChange={(checked) => field.onChange(!!checked)}
                      />
                    )}
                  />
                )}
              </>
            )}

            {step === 2 && (
              <>
                {currentFileName && (
                  <p className="text-muted-foreground text-sm">
                    Current file: <span className="text-foreground font-medium">{currentFileName}</span>
                  </p>
                )}
                <Controller
                  control={control}
                  name="file"
                  render={({ field: { onChange, value } }) => (
                    <FileUploadInput
                      id="answer-file"
                      name="file"
                      label={currentFileName ? 'Replace Answer File (optional)' : 'Answer File'}
                      accept=".txt,.fa,.pda,.cfg,.re,.jff"
                      maxSizeMb={maxMb}
                      value={value}
                      onChange={async (f) => {
                        if (f) {
                          const text = await f.text();
                          if (!text.trimStart().startsWith('<')) {
                            setError('file', {
                              type: 'manual',
                              message: 'File must be a valid XML file (.jff, .fa, .pda, etc.)',
                            });
                            onChange(undefined);
                            return;
                          }
                          const expectedType =
                            type === 'CFG' ? 'GRAMMAR' : type === 'TM' ? 'TURING' : type;
                          const typeMatch = text.match(/<type[^>]*>([\s\S]*?)<\/type>/i);
                          const fileType = typeMatch?.[1]?.trim().toUpperCase();
                          if (fileType && fileType !== expectedType) {
                            setError('file', {
                              type: 'manual',
                              message: `File is type ${fileType} but problem type is ${type}. Please upload the correct file.`,
                            });
                            onChange(undefined);
                            return;
                          }
                          clearErrors('file');
                        }
                        onChange(f);
                      }}
                      error={typeof errors.file?.message === 'string' ? errors.file.message : undefined}
                      disabled={loadingMaxSize || courseIsArchived}
                      hint="Supported formats: .txt, .fa, .pda, .cfg, .re, .jff"
                    />
                  )}
                />
              </>
            )}

            {step === LAST_STEP && review && (
              <div className="space-y-3">
                <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm [&>dd]:min-w-0 [&>dd]:break-words">
                  <dt className="text-muted-foreground">Title</dt>
                  <dd className="font-medium">{review.title || '—'}</dd>
                  <dt className="text-muted-foreground">Type</dt>
                  <dd>{TYPE_LABELS[review.type] ?? review.type}</dd>
                  {(review.type === 'FA' || review.type === 'PDA') && (
                    <>
                      <dt className="text-muted-foreground">Max states</dt>
                      <dd>{review.isUnlimitedStates ? 'Unlimited' : String(review.maxStates ?? '')}</dd>
                    </>
                  )}
                  {review.type === 'FA' && (
                    <>
                      <dt className="text-muted-foreground">Deterministic</dt>
                      <dd>{review.isDeterministic ? 'Yes' : 'No'}</dd>
                    </>
                  )}
                  <dt className="text-muted-foreground">Answer file</dt>
                  <dd>{review.file?.name ?? currentFileName ?? 'None'}</dd>
                </dl>
              </div>
            )}
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost" onClick={resetForm} disabled={isSubmitting}>
                Cancel
              </Button>
            </DialogClose>

            {step > 0 && (
              <Button type="button" variant="secondary" onClick={back} disabled={isSubmitting}>
                Back
              </Button>
            )}

            {step < LAST_STEP ? (
              <Button key="edit-next" type="button" onClick={() => void next()}>
                Next
              </Button>
            ) : (
              <Button
                key="edit-save"
                type="submit"
                disabled={!isValid || isSubmitting || courseIsArchived}
              >
                {isSubmitting ? 'Saving…' : 'Save Changes'}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
