'use client';

import React, { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Stepper } from '@/components/ui/stepper';
import InputGroup from '@/components/ui/InputGroup';
import { Checkbox } from '@/components/ui/checkbox';
import { useForm, Controller, type FieldPath } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { DuplicateFormSchema } from '@/schemas/course';
import type { Course } from '@prisma/client';
import { toast } from 'sonner';
import { apiPaths } from '@/lib/api-paths';

function toDateTimeLocalInTimeZone(date: Date | string, timeZone: string): string {
  const d = new Date(date);
  if (!Number.isFinite(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const year = lookup.year ?? '0000';
  const month = lookup.month ?? '01';
  const day = lookup.day ?? '01';
  const hour = lookup.hour ?? '00';
  const minute = lookup.minute ?? '00';
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

type FormValues = z.input<typeof DuplicateFormSchema>;

// Same wizard shape as CreateCourseDialog: one concern per step, each step
// validating its own fields before advancing.
const STEPS: ReadonlyArray<{ title: string; fields: FieldPath<FormValues>[] }> = [
  { title: 'Details', fields: ['name', 'code', 'semester', 'credits'] },
  {
    title: 'Schedule',
    fields: ['startDate', 'endDate', 'registrationOpenAt', 'registrationCloseAt'],
  },
  { title: 'Content', fields: ['copyMode'] },
  { title: 'Roster', fields: ['copyFaculty', 'copyTAs'] },
  { title: 'Review', fields: [] },
];
const LAST_STEP = STEPS.length - 1;

const COPY_MODE_LABELS: Record<string, string> = {
  assignments: 'Assignments only',
  assignments_with_problems: 'Assignments and their problems',
  problems: 'Problems only',
};

interface Props {
  open: boolean;
  setOpen: (v: boolean) => void;
  // Only base course fields are read (name, code, dates, etc.), so any Course row works.
  course: Course | null;
  timeZone: string;
  onSuccess?: (newId: string) => void;
}

export default function DuplicateCourseDialog({
  open,
  setOpen,
  course,
  timeZone,
  onSuccess,
}: Props) {
  const defaults: FormValues = {
    name: course?.name ?? '',
    code: course?.code ?? '',
    semester: course?.semester ?? '',
    credits: String(course?.credits ?? 3),
    startDate: course ? toDateTimeLocalInTimeZone(course.startDate, timeZone) : '',
    endDate: course ? toDateTimeLocalInTimeZone(course.endDate, timeZone) : '',
    registrationOpenAt: course?.registrationOpenAt
      ? toDateTimeLocalInTimeZone(course.registrationOpenAt, timeZone)
      : '',
    registrationCloseAt: course?.registrationCloseAt
      ? toDateTimeLocalInTimeZone(course.registrationCloseAt, timeZone)
      : '',
    emptyStringNotation: course?.emptyStringNotation ?? 'EPSILON',
    copyMode: 'assignments_with_problems',
    copyFaculty: false,
    copyTAs: false,
  };

  const {
    control,
    handleSubmit,
    reset,
    trigger,
    watch,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(DuplicateFormSchema),
    defaultValues: defaults,
    mode: 'onChange',
    reValidateMode: 'onChange',
  });

  const [step, setStep] = useState(0);
  const [confirmChecked, setConfirmChecked] = useState(false);

  // Keep min (end) in sync with start
  const startDateStr = watch('startDate');
  const registrationOpenAtStr = watch('registrationOpenAt');

  useEffect(() => {
    if (!open) return;
    // reset with current course values when opening (use live course to avoid stale defaults)
    const vals: FormValues = {
      name: course?.name ?? '',
      code: course?.code ?? '',
      semester: course?.semester ?? '',
      credits: String(course?.credits ?? 3),
      startDate: course ? toDateTimeLocalInTimeZone(course.startDate, timeZone) : '',
      endDate: course ? toDateTimeLocalInTimeZone(course.endDate, timeZone) : '',
      registrationOpenAt: course?.registrationOpenAt
        ? toDateTimeLocalInTimeZone(course.registrationOpenAt, timeZone)
        : '',
      registrationCloseAt: course?.registrationCloseAt
        ? toDateTimeLocalInTimeZone(course.registrationCloseAt, timeZone)
        : '',
      emptyStringNotation: course?.emptyStringNotation ?? 'EPSILON',
      copyMode: 'assignments_with_problems',
      copyFaculty: false,
      copyTAs: false,
    };
    reset(vals);
    setStep(0);
    setConfirmChecked(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, course, timeZone]);

  const resetAll = () => {
    setStep(0);
    setConfirmChecked(false);
    reset(defaults, { keepErrors: false });
  };

  // Advance only when the current step's own fields validate; errors render in
  // place and the step holds. (The whole schema still gates the final submit.)
  const next = async () => {
    const ok = await trigger(STEPS[step]?.fields ?? []);
    if (ok) {
      setConfirmChecked(false);
      setStep((s) => Math.min(s + 1, LAST_STEP));
    }
  };
  const back = () => setStep((s) => Math.max(s - 1, 0));

  const onSubmit = async (raw: FormValues) => {
    const courseId = course?.id;
    if (!courseId) {
      toast.error('Cannot duplicate course because the course ID is missing.');
      return;
    }

    // Build payload
    const mode = raw.copyMode ?? 'assignments_with_problems';
    const payload = {
      title: raw.name,
      code: raw.code,
      semester: raw.semester,
      startDate: raw.startDate,
      endDate: raw.endDate,
      registrationOpenAt: raw.registrationOpenAt,
      registrationCloseAt: raw.registrationCloseAt,
      credits: Number(raw.credits),
      copyAssignments: mode === 'assignments' || mode === 'assignments_with_problems',
      copyProblems: mode === 'problems' || mode === 'assignments_with_problems',
      copyFaculty: !!raw.copyFaculty,
      copyTAs: !!raw.copyTAs,
    };

    try {
      const res = await fetch(apiPaths.courseDuplicate(courseId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.message || res.statusText || 'Failed to duplicate');
      }
      const data = await res.json();
      setOpen(false);
      if (onSuccess) {
        onSuccess(data.id);
      } else {
        window.location.href = `/dashboard/courses/${data.id}`;
      }
    } catch (e) {
      const errMsg = (e as Error)?.message ?? String(e);
      toast.error(errMsg || 'Failed to duplicate course');
    }
  };

  // The review step reads straight from the form state.
  const review = step === LAST_STEP ? getValues() : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) resetAll();
      }}
    >
      <DialogContent className="bg-card sm:max-w-3xl">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Copy className="text-muted-foreground size-4" />
            <DialogTitle>Duplicate Course</DialogTitle>
          </div>
        </DialogHeader>

        <Stepper
          steps={STEPS.map((s) => s.title)}
          current={step}
          onStepClick={(index) => setStep(index)}
          className="mb-2"
        />

        <form
          // Only the Review step may submit; earlier steps swallow any submit that
          // slips through (backstop for the button-swap hazard handled below).
          onSubmit={step === LAST_STEP ? handleSubmit(onSubmit) : (e) => e.preventDefault()}
          className="space-y-4"
          onKeyDown={(e) => {
            // Enter advances the wizard instead of submitting early.
            if (e.key === 'Enter' && step < LAST_STEP) {
              e.preventDefault();
              void next();
            }
          }}
        >
          {/* A stable min-height keeps the dialog from resizing between steps. */}
          <div className="min-h-[320px] space-y-4">
            {step === 0 && (
              <>
                <Controller
                  control={control}
                  name="name"
                  render={({ field }) => (
                    <InputGroup
                      label="Course Name"
                      name="name"
                      isValid={!field.value}
                      fieldProps={field}
                      error={errors.name?.message as string | undefined}
                    />
                  )}
                />

                <Controller
                  control={control}
                  name="code"
                  render={({ field }) => (
                    <InputGroup
                      label="Course Code"
                      name="code"
                      isValid={!field.value}
                      fieldProps={field}
                      error={errors.code?.message as string | undefined}
                    />
                  )}
                />

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <Controller
                    control={control}
                    name="semester"
                    render={({ field }) => (
                      <InputGroup
                        label="Semester"
                        name="semester"
                        isValid={!field.value}
                        fieldProps={field}
                        placeholder={`Fall ${new Date().getFullYear()}`}
                        error={errors.semester?.message as string | undefined}
                      />
                    )}
                  />

                  <Controller
                    control={control}
                    name="credits"
                    render={({ field }) => (
                      <InputGroup
                        label="Credits"
                        name="credits"
                        type="number"
                        isValid={!field.value}
                        fieldProps={field}
                        min={1}
                        max={6}
                        error={errors.credits?.message as string | undefined}
                      />
                    )}
                  />
                </div>
              </>
            )}

            {step === 1 && (
              <>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <Controller
                    control={control}
                    name="startDate"
                    render={({ field }) => (
                      <InputGroup
                        label="Start Date & Time"
                        name="startDate"
                        type="datetime-local"
                        isValid={!field.value}
                        fieldProps={{ ...field, value: field.value ?? '' }}
                        error={errors.startDate?.message as string | undefined}
                      />
                    )}
                  />

                  <Controller
                    control={control}
                    name="endDate"
                    render={({ field }) => (
                      <InputGroup
                        label="End Date & Time"
                        name="endDate"
                        type="datetime-local"
                        isValid={!field.value}
                        fieldProps={{ ...field, value: field.value ?? '' }}
                        error={errors.endDate?.message as string | undefined}
                        min={startDateStr || undefined}
                      />
                    )}
                  />
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <Controller
                    control={control}
                    name="registrationOpenAt"
                    render={({ field }) => (
                      <InputGroup
                        label="Self Registration Opens"
                        name="registrationOpenAt"
                        type="datetime-local"
                        isValid={!field.value}
                        fieldProps={{ ...field, value: field.value ?? '' }}
                        error={errors.registrationOpenAt?.message as string | undefined}
                      />
                    )}
                  />

                  <Controller
                    control={control}
                    name="registrationCloseAt"
                    render={({ field }) => (
                      <InputGroup
                        label="Self Registration Closes"
                        name="registrationCloseAt"
                        type="datetime-local"
                        isValid={!field.value}
                        fieldProps={{ ...field, value: field.value ?? '' }}
                        error={errors.registrationCloseAt?.message as string | undefined}
                        min={registrationOpenAtStr || undefined}
                      />
                    )}
                  />
                </div>
              </>
            )}

            {step === 2 && (
              <div className="space-y-2">
                <div className="text-sm font-medium">What would you like to copy?</div>
                <Controller
                  control={control}
                  name="copyMode"
                  render={({ field }) => (
                    <div className="space-y-1">
                      <label className="flex items-start gap-2">
                        <input
                          type="radio"
                          name="copyMode"
                          value="assignments"
                          checked={field.value === 'assignments'}
                          onChange={() => field.onChange('assignments')}
                        />
                        <div>
                          <div className="font-medium">Assignments only</div>
                          <div className="text-muted-foreground text-sm">
                            Copy assignments only; assignments will not reference problems.
                          </div>
                        </div>
                      </label>

                      <label className="flex items-start gap-2">
                        <input
                          type="radio"
                          name="copyMode"
                          value="assignments_with_problems"
                          checked={field.value === 'assignments_with_problems'}
                          onChange={() => field.onChange('assignments_with_problems')}
                        />
                        <div>
                          <div className="font-medium">Assignments and their problems</div>
                          <div className="text-muted-foreground text-sm">
                            Copy assignments and duplicate the problems attached to each
                            assignment; new assignments will reference copied problems only.
                          </div>
                        </div>
                      </label>

                      <label className="flex items-start gap-2">
                        <input
                          type="radio"
                          name="copyMode"
                          value="problems"
                          checked={field.value === 'problems'}
                          onChange={() => field.onChange('problems')}
                        />
                        <div>
                          <div className="font-medium">Problems only</div>
                          <div className="text-muted-foreground text-sm">
                            Copy problems only; no assignments will be created.
                          </div>
                        </div>
                      </label>
                    </div>
                  )}
                />
              </div>
            )}

            {step === 3 && (
              <div className="space-y-3">
                <div className="text-sm font-medium">Choose roster copy options</div>
                <div className="flex items-center gap-4">
                  <Controller
                    control={control}
                    name="copyFaculty"
                    render={({ field }) => (
                      <label className="flex items-center gap-2">
                        <Checkbox
                          checked={!!field.value}
                          onCheckedChange={(val) => field.onChange(!!val)}
                        />
                        <span className="text-sm">Copy faculty roster</span>
                      </label>
                    )}
                  />

                  <Controller
                    control={control}
                    name="copyTAs"
                    render={({ field }) => (
                      <label className="flex items-center gap-2">
                        <Checkbox
                          checked={!!field.value}
                          onCheckedChange={(val) => field.onChange(!!val)}
                        />
                        <span className="text-sm">Copy TA roster</span>
                      </label>
                    )}
                  />
                </div>
                <div className="text-muted-foreground text-xs">
                  The current user will always be added as faculty to the duplicated course.
                  Students are never copied.
                </div>
              </div>
            )}

            {step === LAST_STEP && review && (
              <div className="space-y-3">
                {/* min-w-0 + break-words keep long names from overflowing on phones. */}
                <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm [&>dd]:min-w-0 [&>dd]:break-words">
                  <dt className="text-muted-foreground">Name</dt>
                  <dd className="font-medium">{review.name}</dd>
                  <dt className="text-muted-foreground">Code</dt>
                  <dd className="font-medium">{review.code}</dd>
                  <dt className="text-muted-foreground">Semester</dt>
                  <dd>{review.semester}</dd>
                  <dt className="text-muted-foreground">Credits</dt>
                  <dd>{review.credits}</dd>
                  <dt className="text-muted-foreground">Runs</dt>
                  <dd>
                    {formatLocal(review.startDate)} to {formatLocal(review.endDate)}
                  </dd>
                  <dt className="text-muted-foreground">Self registration</dt>
                  <dd>
                    {formatLocal(review.registrationOpenAt)} to{' '}
                    {formatLocal(review.registrationCloseAt)}
                  </dd>
                  <dt className="text-muted-foreground">Copy</dt>
                  <dd>{COPY_MODE_LABELS[review.copyMode ?? ''] ?? review.copyMode}</dd>
                  <dt className="text-muted-foreground">Faculty roster</dt>
                  <dd>{review.copyFaculty ? 'Copied' : 'Not copied'}</dd>
                  <dt className="text-muted-foreground">TA roster</dt>
                  <dd>{review.copyTAs ? 'Copied' : 'Not copied'}</dd>
                </dl>

                <p className="text-muted-foreground text-xs">
                  The duplicated course is created unpublished, you are added as faculty, and
                  submissions are never copied.
                </p>

                <label className="mt-2 flex items-center gap-2">
                  <Checkbox
                    checked={confirmChecked}
                    disabled={isSubmitting}
                    onCheckedChange={(val) => setConfirmChecked(!!val)}
                  />
                  <span className="text-sm">
                    I confirm I want to duplicate this course with the options above
                  </span>
                </label>
              </div>
            )}
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button
                type="button"
                variant="ghost"
                disabled={isSubmitting}
                onClick={resetAll}
              >
                Cancel
              </Button>
            </DialogClose>

            {step > 0 && (
              <Button type="button" variant="secondary" disabled={isSubmitting} onClick={back}>
                Back
              </Button>
            )}

            {/* Distinct keys force a fresh button node when Next becomes Duplicate,
                so the pending click's default action can't submit the form (same
                hazard as CreateCourseDialog). */}
            {step < LAST_STEP ? (
              <Button key="wizard-next" type="button" disabled={isSubmitting} onClick={() => void next()}>
                Next
              </Button>
            ) : (
              <Button key="wizard-submit" type="submit" disabled={isSubmitting || !confirmChecked}>
                {isSubmitting ? 'Copying…' : 'Duplicate Course'}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Render a datetime-local string ("2026-08-25T09:00") as "2026-08-25 09:00". */
function formatLocal(value: string | undefined) {
  return value ? value.replace('T', ' ') : '';
}
