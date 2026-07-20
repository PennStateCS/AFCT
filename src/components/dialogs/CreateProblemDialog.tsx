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
import { Textarea } from '@/components/ui/textarea';
import InputGroup from '@/components/ui/InputGroup';
import { LimitField } from '@/components/ui/LimitField';
import SwitchField from '@/components/ui/SwitchField';
import { Stepper } from '@/components/ui/stepper';

import { useEffect, useMemo, useState } from 'react';
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
import { useMaxUploadSize } from '@/hooks/useMaxUploadSize';
import { apiPaths } from '@/lib/api-paths';
import { apiClient, ApiError } from '@/lib/api/fetch-client';

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
  { title: 'Details', fields: ['title', 'description'] },
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
  // unlimited submissions, autograder on.
  const [linkMaxPoints, setLinkMaxPoints] = useState('100');
  const [linkUnlimited, setLinkUnlimited] = useState(true);
  const [linkMaxSubmissions, setLinkMaxSubmissions] = useState('1');
  const [linkAutograder, setLinkAutograder] = useState(true);

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
    formState: { errors, isSubmitting, isValid },
  } = useForm<FormValues>({
    resolver: zodResolver(ProblemFormSchema),
    defaultValues: defaults,
    mode: 'onChange',
    reValidateMode: 'onChange',
  });

  const type = watch('type');
  const isUnlimitedStates = watch('isUnlimitedStates');
  const file = watch('file');

  const { maxMb, loading: loadingMaxSize } = useMaxUploadSize();

  const resetForm = () => {
    setStep(0);
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
      formData.append('description', values.description ?? '');
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
      // with it using the per-assignment settings gathered in the wizard (best-effort).
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
              },
            ],
          });
        } catch (err) {
          console.error('Failed to add created problem to assignment:', err);
        }
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

        <form
          onSubmit={step === LAST_STEP ? handleSubmit(onSubmit) : (e) => e.preventDefault()}
          className="space-y-4"
          onKeyDown={(e) => {
            // Enter advances from a single-line field, but not from a textarea (newline).
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
                      <Label htmlFor="problem-description" className="mb-2 block">
                        Description
                      </Label>
                      <Textarea
                        {...field}
                        id="problem-description"
                        value={field.value ?? ''}
                        rows={4}
                        placeholder="Optional description"
                        aria-invalid={errors.description ? true : undefined}
                        aria-describedby={
                          errors.description ? 'problem-description-error' : undefined
                        }
                      />
                      {errors.description && (
                        <p
                          id="problem-description-error"
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
                      <Label htmlFor="problem-type" className="mb-2 block">
                        Problem Type
                      </Label>
                      <select
                        id="problem-type"
                        className="bg-card w-full rounded border border-black p-2"
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
                        // Check JFLAP structure type matches the selected problem type
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
                  <dd>{review.file?.name ?? 'None'}</dd>
                  {inAssignment && (
                    <>
                      <dt className="text-muted-foreground">Max points</dt>
                      <dd>{Math.max(0, linkPointsValue)}</dd>
                      <dt className="text-muted-foreground">Accepted submissions</dt>
                      <dd>{linkUnlimited ? 'Unlimited' : String(linkMaxSubmissions)}</dd>
                      <dt className="text-muted-foreground">Automatically graded</dt>
                      <dd>{linkAutograder ? 'Yes' : 'No'}</dd>
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
  );
}
