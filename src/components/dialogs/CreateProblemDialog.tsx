'use client';

import type { Problem } from '@prisma/client';
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
import InputGroup from '@/components/ui/InputGroup';
import { RichDescriptionField } from '@/components/rich-description/RichDescriptionField';
import { useDiscardGuard } from '@/components/unsaved-changes/useDiscardGuard';
import { serializeRichDescription, type RichDescriptionEnvelope } from '@/lib/rich-description';
import { ANSWER_FILE_EXTENSIONS, ANSWER_FILE_HINT, answerFileRejection } from '@/lib/answer-file';
import { LimitField } from '@/components/ui/LimitField';
import SwitchField from '@/components/ui/SwitchField';
import { Stepper } from '@/components/ui/stepper';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useForm, Controller, type FieldPath } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import {
  CreateProblemSchema,
  ProblemFormSchema,
  type CreateProblemInput,
  type ProblemFormRaw,
} from '@/schemas/problem';
import { showToast } from '@/lib/toast';
import FileUploadInput from '@/components/FileUploadInput';
import { useMaxUploadSize } from '@/hooks/use-max-upload-size';
import { apiPaths } from '@/lib/api-paths';
import { apiClient, ApiError } from '@/lib/api/fetch-client';
import { shouldEnterAdvanceStep } from '@/lib/wizard-keyboard';

type CreateProblemDialogProps = {
  open: boolean;
  setOpen: (open: boolean) => void;
  courseId: string;
  courseIsArchived: boolean;
  // Optional assignment context: when provided, the dialog will automatically
  // add the created problem to the assignment.
  assignmentId?: string;
  onCreated?: (created?: Problem, createdSuccessfully?: boolean) => void;
};

// RHF state BEFORE transforms
type FormValues = ProblemFormRaw;
// Parsed AFTER Zod transforms
type ParsedValues = CreateProblemInput;

const TYPE_LABELS: Record<string, string> = {
  FA: 'Finite Automaton',
  PDA: 'Push-Down Automaton',
  CFG: 'Context-Free Grammar',
  RE: 'Regular Expression',
};

type WizardStep = { title: string; fields: FieldPath<FormValues>[] };

// Bank create: the problem definition only.
const BANK_STEPS: ReadonlyArray<WizardStep> = [
  { title: 'Details', fields: ['title', 'descriptionJson'] },
  {
    title: 'Type',
    fields: ['type', 'maxStates', 'isUnlimitedStates', 'isDeterministic'],
  },
  { title: 'Answer File', fields: ['file'] },
  { title: 'Review', fields: [] },
];
// When created from an assignment, an extra step gathers the per-assignment link settings
// (points, accepted submissions, autograding) so create + associate happen in one flow.
const SETTINGS_STEP: WizardStep = { title: 'Assignment Settings', fields: [] };

// A guided wizard mirroring the create-assignment wizard. From the course bank it creates
// the problem definition only (Details, Type, Answer File, Review). Opened from an
// assignment it adds an Assignment Settings step and associates the new problem with that
// assignment using those settings.
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

export function CreateProblemDialog({
  open,
  setOpen,
  courseId,
  courseIsArchived,
  assignmentId,
  onCreated,
}: CreateProblemDialogProps) {
  const [step, setStep] = useState(0);
  const inAssignment = !!assignmentId;

  // The wizard gains an "Assignment Settings" step (before Review) when opened from an
  // assignment. Answer File stays at index 2 in both shapes, so its gates are unaffected.
  const STEPS = useMemo<ReadonlyArray<WizardStep>>(
    () => (inAssignment ? [...BANK_STEPS.slice(0, 3), SETTINGS_STEP, BANK_STEPS[3]!] : BANK_STEPS),
    [inAssignment],
  );
  const LAST_STEP = STEPS.length - 1;

  // Per-assignment link settings, gathered only in the assignment flow. Kept as local state
  // (not on the strict ProblemFormSchema form) since they belong to AssignmentProblem, not
  // the bank problem. Defaults mirror the "Add existing problem" dialog: 100 points,
  // unlimited submissions, autograder on, feedback shown.
  const [linkMaxPoints, setLinkMaxPoints] = useState('100');
  const [linkUnlimited, setLinkUnlimited] = useState(true);
  const [linkMaxSubmissions, setLinkMaxSubmissions] = useState('1');
  const [linkAutograder, setLinkAutograder] = useState(true);
  const [linkShowFeedback, setLinkShowFeedback] = useState(true);

  const linkPointsValue = Number(linkMaxPoints);
  const linkPointsInvalid = !Number.isFinite(linkPointsValue) || linkPointsValue < 0;
  const linkSubmissionsValue = Number(linkMaxSubmissions);
  const linkSubmissionsInvalid =
    !linkUnlimited && (!Number.isInteger(linkSubmissionsValue) || linkSubmissionsValue < 1);
  const isSettingsStep = STEPS[step]?.title === 'Assignment Settings';
  const settingsInvalid = linkPointsInvalid || linkSubmissionsInvalid;

  const defaults: FormValues = useMemo(
    () => ({
      title: '',
      description: '',
      descriptionJson: null,
      type: 'FA',
      isUnlimitedStates: true,
      maxStates: 100,
      isDeterministic: false,
      file: undefined,
      courseId: courseId,
    }),
    [courseId],
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
  const file = watch('file');

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
    setLinkMaxPoints('100');
    setLinkUnlimited(true);
    setLinkMaxSubmissions('1');
    setLinkAutograder(true);
  };

  // Reset the form and return to step 1 each time the dialog opens.
  useEffect(() => {
    if (open) resetForm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaults]);

  const next = async () => {
    // The answer file is required to leave its step (the form schema treats it as optional).
    if (step === 2 && !file) return;
    // The assignment-settings step validates its own local fields (not RHF fields).
    if (isSettingsStep && settingsInvalid) return;
    const ok = await trigger(STEPS[step]?.fields ?? []);
    if (ok) setStep((s) => Math.min(s + 1, LAST_STEP));
  };
  const back = () => setStep((s) => Math.max(s - 1, 0));

  const onSubmit = async (raw: FormValues) => {
    try {
      // Parse with CreateProblemSchema which requires file
      const values: ParsedValues = CreateProblemSchema.parse(raw);

      const formData = new FormData();
      formData.append('title', values.title);
      // Rich JSON wins and the server derives the plain text from it. With an untouched editor
      // neither field carries content, so the problem stays PLAIN_TEXT with no description.
      if (values.descriptionJson) {
        formData.append('descriptionJson', JSON.stringify(values.descriptionJson));
      } else {
        formData.append('description', values.description ?? '');
      }
      formData.append('type', values.type);
      formData.append('courseId', values.courseId);

      if (values.type === 'FA' || values.type === 'PDA') {
        formData.append(
          'maxStates',
          values.isUnlimitedStates ? '-1' : String(values.maxStates ?? 0),
        );
      }
      if (values.type === 'FA') {
        formData.append('isDeterministic', String(!!values.isDeterministic));
      }

      formData.append('file', values.file);

      let created: Problem | null = null;
      try {
        created = await apiClient.postForm<Problem>(
          apiPaths.courseProblems(values.courseId),
          formData,
        );
      } catch (err) {
        if (err instanceof ApiError) {
          console.error('Failed to create problem:', err.message);
          // 4xx = validation/user error → show inline on the file field; 5xx → toast. The
          // file lives on step 3, so jump there so the message is visible.
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

      // If we were opened in the context of an assignment, associate the created problem
      // with it using the per-assignment settings gathered in the wizard.
      let linked = true;
      if (created?.id && assignmentId) {
        try {
          await apiClient.post(apiPaths.assignmentProblems(courseId, assignmentId), {
            problemIds: [created.id],
            problemSettings: [
              {
                problemId: created.id,
                maxPoints: Math.max(0, linkPointsValue),
                maxSubmissions: linkUnlimited ? -1 : Math.max(1, Math.floor(linkSubmissionsValue)),
                autograderEnabled: linkAutograder,
                showFeedback: linkShowFeedback,
              },
            ],
          });
        } catch (err) {
          linked = false;
          console.error('Failed to add created problem to assignment:', err);
        }
      }

      // This dialog performs the write, so it reports the outcome. Half-success is its own
      // message: the problem exists in the bank, but it is not on the assignment, and silently
      // closing left the author thinking it was. They can add it from the Problems tab.
      if (linked) {
        showToast.created('Problem', { name: created?.title });
      } else {
        showToast.warning('Problem created, but it was not added to this assignment', {
          description: 'Add it from the assignment’s Problems tab.',
        });
      }

      onCreated?.(created ?? undefined, true);
      resetForm();
      setOpen(false);
    } catch (error) {
      console.error('Form submission error:', error);
      if (typeof error === 'string') {
        setStep(2);
        setError('file', { type: 'manual', message: error });
        return;
      }
      if (error instanceof z.ZodError) {
        // Handle Zod validation errors (Zod 4 renamed `.errors` to `.issues`).
        const message = error.issues?.map((e) => e.message).join();
        showToast.error(`Error: ${message}`);
      }
    }
  };

  const review = step === LAST_STEP ? getValues() : null;

  // Anything typed, picked, or uploaded counts; the five link settings live outside the form,
  // so they are compared against their defaults by hand. Escape or the X on a dirty dialog asks
  // before discarding; a successful create closes via setOpen(false) directly and is never asked.
  const linkSettingsChanged =
    inAssignment &&
    (linkMaxPoints !== '100' ||
      !linkUnlimited ||
      linkMaxSubmissions !== '1' ||
      !linkAutograder ||
      !linkShowFeedback);
  const { descriptionDirty, onDocumentReady, onDescriptionChange } = useDescriptionDirty();
  // Every changed field EXCEPT the description, which is compared by content above.
  const otherFieldsDirty = Object.keys(dirtyFields).some((k) => k !== 'descriptionJson');

  const { requestClose, discardConfirm } = useDiscardGuard({
    dirty: open && (descriptionDirty || otherFieldsDirty || linkSettingsChanged),
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
            <DialogTitle>Create Problem</DialogTitle>
            <DialogDescription className="sr-only">
              Create a problem step by step: details, type, the answer file
              {inAssignment ? ', assignment settings' : ''}, then review.
            </DialogDescription>
          </DialogHeader>

          <Stepper
            steps={STEPS.map((s) => s.title)}
            current={step}
            onStepClick={(index) => setStep(index)}
            className="mb-2"
          />

          {/* Announce step changes to screen readers (the Stepper is visual). */}
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
                        requiredMark
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
                        value={(field.value as RichDescriptionEnvelope | null | undefined) ?? null}
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
                        <Label htmlFor="problem-type" className="mb-2 block">
                          Problem Type
                        </Label>
                        <select
                          id="problem-type"
                          className="bg-card border-input w-full rounded border p-2"
                          value={field.value ?? ''}
                          onChange={(e) => field.onChange(e.target.value as ProblemFormRaw['type'])}
                        >
                          <option value="FA">Finite Automaton</option>
                          <option value="PDA">Push-Down Automaton</option>
                          <option value="CFG">Context-Free Grammar</option>
                          <option value="RE">Regular Expression</option>
                        </select>
                      </div>
                    )}
                  />

                  {/* Max States (FA/PDA only) */}
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

                  {/* Deterministic (FA only) */}
                  {type === 'FA' && (
                    <Controller
                      control={control}
                      name="isDeterministic"
                      render={({ field }) => (
                        <SwitchField
                          label="Deterministic"
                          name="isDeterministic"
                          id="isDeterministic"
                          checked={!!field.value}
                          onCheckedChange={(checked) => field.onChange(!!checked)}
                        />
                      )}
                    />
                  )}
                </>
              )}

              {step === 2 && (
                <Controller
                  control={control}
                  name="file"
                  render={({ field: { onChange, value } }) => (
                    <FileUploadInput
                      id="answer-file"
                      name="file"
                      label="Answer File"
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
                        (typeof errors.file?.message === 'string' ? errors.file.message : undefined)
                      }
                      disabled={loadingMaxSize || courseIsArchived}
                      hint={ANSWER_FILE_HINT}
                    />
                  )}
                />
              )}

              {isSettingsStep && (
                <div className="space-y-4">
                  <p className="text-muted-foreground text-sm">
                    How this problem counts in this assignment. You can change these later on the
                    assignment&rsquo;s Problems tab.
                  </p>
                  <InputGroup
                    label="Max Points"
                    name="new-problem-max-points"
                    type="number"
                    min={0}
                    step="1"
                    value={linkMaxPoints}
                    setValue={setLinkMaxPoints}
                    error={linkPointsInvalid ? 'Max points must be zero or greater.' : undefined}
                  />
                  <LimitField
                    label="Accepted Submissions"
                    name="new-problem-max-submissions"
                    unlimited={linkUnlimited}
                    onUnlimitedChange={setLinkUnlimited}
                    value={linkMaxSubmissions}
                    onValueChange={setLinkMaxSubmissions}
                    min={1}
                    placeholder="e.g. 5"
                    error={
                      linkSubmissionsInvalid
                        ? 'Enter a number of at least 1, or choose Unlimited.'
                        : undefined
                    }
                  />
                  <SwitchField
                    label="Automatically Graded"
                    name="new-problem-autograder"
                    id="new-problem-autograder"
                    checked={linkAutograder}
                    onCheckedChange={(checked) => setLinkAutograder(!!checked)}
                    descriptionPlacement="inline"
                    description="When enabled, submissions are evaluated and graded automatically. Turn this off if you want to review and grade submissions manually."
                  />
                  <SwitchField
                    label="Show Feedback to Students"
                    name="new-problem-show-feedback"
                    id="new-problem-show-feedback"
                    checked={linkShowFeedback}
                    onCheckedChange={(checked) => setLinkShowFeedback(!!checked)}
                    descriptionPlacement="inline"
                    description="When disabled, students see only whether their submission was correct. Feedback is still recorded and remains visible to instructors."
                  />
                </div>
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
                    <dd>{review.file?.name ?? 'None'}</dd>
                    {inAssignment && (
                      <>
                        <dt className="text-muted-foreground">Max points</dt>
                        <dd>{Math.max(0, linkPointsValue)}</dd>
                        <dt className="text-muted-foreground">Accepted submissions</dt>
                        <dd>{linkUnlimited ? 'Unlimited' : String(linkMaxSubmissions)}</dd>
                        <dt className="text-muted-foreground">Automatically graded</dt>
                        <dd>{linkAutograder ? 'Yes' : 'No'}</dd>
                        <dt className="text-muted-foreground">Feedback shown to students</dt>
                        <dd>{linkShowFeedback ? 'Yes' : 'No'}</dd>
                      </>
                    )}
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
                <Button
                  key="problem-next"
                  type="button"
                  onClick={() => void next()}
                  disabled={(step === 2 && !file) || (isSettingsStep && settingsInvalid)}
                >
                  Next
                </Button>
              ) : (
                <Button
                  key="problem-create"
                  type="submit"
                  disabled={!isValid || isSubmitting || !file || courseIsArchived}
                >
                  {isSubmitting ? 'Creating…' : 'Create Problem'}
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
