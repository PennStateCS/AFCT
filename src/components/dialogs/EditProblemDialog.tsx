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
import { RichDescriptionField } from '@/components/rich-description/RichDescriptionField';
import { useDiscardGuard } from '@/components/unsaved-changes/useDiscardGuard';
import {
  asRichDescription,
  serializeRichDescription,
  type RichDescriptionEnvelope,
} from '@/lib/rich-description';
import InputGroup from '@/components/ui/InputGroup';
import SwitchField from '@/components/ui/SwitchField';
import { LimitField } from '@/components/ui/LimitField';
import { Stepper } from '@/components/ui/stepper';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useForm, Controller, type FieldPath } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import type { Problem } from '@prisma/client';
import { ProblemFormSchema, UpdateProblemSchema, type ProblemFormRaw } from '@/schemas/problem';
import FileUploadInput from '@/components/FileUploadInput';
import { useMaxUploadSize } from '@/hooks/use-max-upload-size';
import { showToast } from '@/lib/toast';
import { ANSWER_FILE_EXTENSIONS, ANSWER_FILE_HINT, answerFileRejection } from '@/lib/answer-file';
import { apiPaths } from '@/lib/api-paths';
import { apiClient, ApiError } from '@/lib/api/fetch-client';
import { shouldEnterAdvanceStep } from '@/lib/wizard-keyboard';

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
  { title: 'Details', fields: ['title', 'descriptionJson'] },
  { title: 'Type', fields: ['type', 'maxStates', 'isUnlimitedStates', 'isDeterministic'] },
  { title: 'Answer File', fields: ['file'] },
  { title: 'Review', fields: [] },
];
const LAST_STEP = STEPS.length - 1;

// A four-step wizard mirroring the create-problem wizard, for editing the bank problem
// definition (title, description, type, FA/PDA shape, answer file). The answer file is
// optional on edit (the current one is kept) unless the problem type changes.
/**
 * Is the description genuinely different from the one that was loaded?
 *
 * react-hook-form compares the emitted document against the stored JSON, and Tiptap NORMALISES
 * what it parses, so the two are never textually equal once the editor has touched the field:
 * `isDirty` latched true the moment anyone put a caret in the description, and stayed true even
 * after an undo. The editor reports its loaded document once, before any edit, and that is the
 * honest baseline. Same comparison the assignment form uses.
 */
function useDescriptionDirty() {
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [currentKey, setCurrentKey] = useState<string | null>(null);
  const onDocumentReady = useCallback((value: RichDescriptionEnvelope) => {
    const key = serializeRichDescription(value);
    setLoadedKey(key);
    setCurrentKey(key);
  }, []);
  const onDescriptionChange = useCallback(
    (value: RichDescriptionEnvelope) => setCurrentKey(serializeRichDescription(value)),
    [],
  );
  const descriptionDirty = loadedKey !== null && currentKey !== null && currentKey !== loadedKey;
  return { descriptionDirty, onDocumentReady, onDescriptionChange };
}

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
      // The stored document when the problem has one; null for a legacy plain-text problem,
      // which then converts only if the author edits the description.
      descriptionJson: asRichDescription(
        (problem as { descriptionJson?: unknown }).descriptionJson,
      ),
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
    formState: { errors, isSubmitting, isValid, dirtyFields },
  } = useForm<FormValues>({
    resolver: zodResolver(ProblemFormSchema),
    defaultValues: defaults,
    mode: 'onChange',
    reValidateMode: 'onChange',
  });

  /**
   * Why the last answer file was refused, kept outside react-hook-form.
   *
   * Refusing a file also clears the field, and with `mode: 'onChange'` and a zod resolver that
   * write revalidates and replaces every error, taking a manual `setError` with it before it can
   * be read (#791). Holding the message here is what makes a rejected upload say so instead of
   * looking like nothing happened.
   */
  const [answerFileError, setAnswerFileError] = useState<string | undefined>();

  const type = watch('type');
  const isUnlimitedStates = watch('isUnlimitedStates');

  const { maxMb, loading: loadingMaxSize } = useMaxUploadSize();

  // A rejection naming the old type stops being true the moment the type changes, and the
  // wizard lets you step back and change it.
  useEffect(() => {
    setAnswerFileError(undefined);
  }, [type]);

  const resetForm = () => {
    setStep(0);
    setAnswerFileError(undefined);
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
        setError('file', {
          type: 'manual',
          message: 'Upload a new solution file for the new type.',
        });
        return;
      }

      const formData = new FormData();
      formData.append('title', payload.title ?? '');
      // Rich JSON wins and the server derives the plain text from it. Without a document this
      // stays a plain-text write of the existing description.
      if (payload.descriptionJson) {
        formData.append('descriptionJson', JSON.stringify(payload.descriptionJson));
      } else {
        formData.append('description', payload.description ?? '');
      }
      formData.append('type', payload.type ?? '');
      formData.append('courseId', payload.courseId ?? '');

      if (payload.type === 'FA' || payload.type === 'PDA') {
        formData.append(
          'maxStates',
          String(payload.isUnlimitedStates ? -1 : (payload.maxStates ?? 0)),
        );
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

      showToast.updated('Problem', { name: payload.title });
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
        showToast.error('Some fields need attention. Check the highlighted fields and save again.');
        return;
      }
      showToast.error('Could not save the problem. Check your connection and try again.');
    }
  };

  const review = step === LAST_STEP ? getValues() : null;
  const currentFileName = problem.originalFileName ?? problem.fileName ?? null;

  // Any change to the loaded problem counts (react-hook-form compares against the loaded
  // values). Escape or the X on a dirty dialog asks before discarding; a successful save
  // closes via setOpen(false) directly and is never asked.
  const { descriptionDirty, onDocumentReady, onDescriptionChange } = useDescriptionDirty();
  // Every changed field EXCEPT the description, which is compared by content above.
  const otherFieldsDirty = Object.keys(dirtyFields).some((k) => k !== 'descriptionJson');

  const { requestClose, discardConfirm } = useDiscardGuard({
    dirty: open && (descriptionDirty || otherFieldsDirty),
    onDiscard: () => {
      setOpen(false);
      resetForm();
    },
  });

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(val) => {
          if (!val) {
            requestClose();
            return;
          }
          setOpen(val);
        }}
      >
        <DialogContent className="sm:max-w-2xl" onInteractOutside={(e) => e.preventDefault()}>
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

          {/* The form owns an onKeyDown that scopes Enter to single-line text inputs so it
            advances the wizard instead of submitting early. That is deliberate keyboard
            management on the form element, not an interactive-role gap. */}
          {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
          <form
            onSubmit={step === LAST_STEP ? handleSubmit(onSubmit) : (e) => e.preventDefault()}
            className="space-y-4"
            onKeyDown={(e) => {
              // Enter advances only from a single-line text input; every other control
              // (select, file, radio, combobox, textarea) keeps its native Enter behavior.
              if (e.key !== 'Enter' || step >= LAST_STEP) return;
              if (!shouldEnterAdvanceStep(e.target)) return;
              e.preventDefault();
              void next();
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
                    name="descriptionJson"
                    render={({ field }) => (
                      <RichDescriptionField
                        // Remounted per problem so the editor reloads its initial content.
                        key={problem.id}
                        value={
                          (field.value as RichDescriptionEnvelope | null | undefined) ??
                          defaults.description ??
                          ''
                        }
                        onChange={(value) => {
                          field.onChange(value);
                          onDescriptionChange(value);
                        }}
                        onDocumentReady={onDocumentReady}
                        error={errors.descriptionJson?.message}
                        placeholder="Optional description"
                        minHeightClassName="min-h-32"
                      />
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
                          className="bg-card border-input w-full rounded border p-2"
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
                      Current file:{' '}
                      <span className="text-foreground font-medium">{currentFileName}</span>
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
                        accept={ANSWER_FILE_EXTENSIONS}
                        maxSizeMb={maxMb}
                        value={value}
                        onChange={async (f) => {
                          if (f) {
                            const rejection = answerFileRejection(await f.text(), type);
                            if (rejection) {
                              // Not setError: the reset below revalidates through the zod resolver, which
                              // recomputes every error and drops a manual one before it is ever seen (#791).
                              setAnswerFileError(rejection);
                              onChange(undefined);
                              return;
                            }
                            clearErrors('file');
                          }
                          setAnswerFileError(undefined);
                          onChange(f);
                        }}
                        error={
                          answerFileError ??
                          (typeof errors.file?.message === 'string'
                            ? errors.file.message
                            : undefined)
                        }
                        disabled={loadingMaxSize || courseIsArchived}
                        hint={ANSWER_FILE_HINT}
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
                        <dd>
                          {review.isUnlimitedStates ? 'Unlimited' : String(review.maxStates ?? '')}
                        </dd>
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
      {discardConfirm}
    </>
  );
}
