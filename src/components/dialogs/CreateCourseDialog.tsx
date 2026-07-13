'use client';

import React, { useMemo, useState } from 'react';
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
import { Stepper } from '@/components/ui/stepper';
import { toast } from 'sonner';
import InputGroup from '@/components/ui/InputGroup';
import SelectField from '@/components/ui/SelectField';
import { SearchableMultiSelect } from '@/components/ui/SearchableMultiSelect';
import { EMPTY_STRING_NOTATION_OPTIONS } from '@/lib/empty-string-notation';
import { COMMON_TIMEZONES, formatTimezoneLabel } from '@/lib/timezones';

import { useForm, Controller, type FieldPath } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  CreateCourseFormSchema, // Form schema (no transformations)
} from '@/schemas/course';
import type { z } from 'zod';
import { apiPaths } from '@/lib/api-paths';
import { apiClient, ApiError } from '@/lib/api/fetch-client';
import { useFacultyTaOptions, getUserName } from './useFacultyTaOptions';

// RHF form state = Zod INPUT (strings for datetime-local)
type FormValues = z.input<typeof CreateCourseFormSchema>;

// The wizard's steps, each owning the fields it validates before advancing.
// Timezone comes first in Schedule deliberately: it anchors how every date
// entered after it is interpreted.
const STEPS: ReadonlyArray<{ title: string; fields: FieldPath<FormValues>[] }> = [
  { title: 'Details', fields: ['name', 'code', 'semester', 'credits'] },
  {
    title: 'Schedule',
    fields: ['timezone', 'startDate', 'endDate', 'registrationOpenAt', 'registrationCloseAt'],
  },
  { title: 'Faculty & TAs', fields: ['instructorIds', 'taIds'] },
  { title: 'Options', fields: ['emptyStringNotation'] },
  { title: 'Review', fields: [] },
];
const LAST_STEP = STEPS.length - 1;

interface CreateCourseDialogProps {
  open: boolean;
  setOpen: (open: boolean) => void;
  onSuccess?: () => void;
}

export function CreateCourseDialog({ open, setOpen, onSuccess }: CreateCourseDialogProps) {
  const [step, setStep] = useState(0);

  // Default the course timezone to the creator's browser zone — a sensible starting
  // point they can change. (The server falls back to the system zone if omitted.)
  const browserTz = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', []);

  // Default form values (strings for datetime-local)
  const defaults: FormValues = useMemo(
    () => ({
      name: '',
      code: '',
      semester: '',
      credits: '3',
      startDate: '', // <- strings for input type="datetime-local"
      endDate: '',
      registrationOpenAt: '',
      registrationCloseAt: '',
      instructorIds: [],
      taIds: [],
      emptyStringNotation: 'EPSILON',
      timezone: COMMON_TIMEZONES.includes(browserTz as (typeof COMMON_TIMEZONES)[number])
        ? browserTz
        : 'UTC',
    }),
    [browserTz],
  );

  const {
    control,
    handleSubmit,
    reset,
    watch,
    trigger,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(CreateCourseFormSchema),
    defaultValues: defaults,
    mode: 'onChange',
    reValidateMode: 'onChange',
  });

  const startDateStr = watch('startDate'); // string (YYYY-MM-DDTHH:MM)

  // Faculty/TA option lists for the roster step (shared with DuplicateCourseDialog).
  const { facultyList, taList } = useFacultyTaOptions(open);

  const resetForm = () => {
    setStep(0);
    reset(defaults, {
      keepDirty: false,
      keepTouched: false,
      keepErrors: false,
      keepValues: false,
    });
  };

  // Advance only when the current step's own fields validate; errors render in
  // place and the step holds. (The whole schema still gates the final submit.)
  const next = async () => {
    const ok = await trigger(STEPS[step]?.fields ?? []);
    if (ok) setStep((s) => Math.min(s + 1, LAST_STEP));
  };
  const back = () => setStep((s) => Math.max(s - 1, 0));

  const onSubmit = async (raw: FormValues) => {
    const payload: Record<string, unknown> = {
      ...raw,
      code: raw.code.trim().replace(/\s+/g, ' ').toUpperCase(),
      credits: Number(raw.credits),
    };

    try {
      await apiClient.post(apiPaths.courses(), payload);
      toast.success('Course created successfully');
      resetForm();
      setOpen(false);
      onSuccess?.();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to create course');
    }
  };

  // The review step reads straight from the form state.
  const review = step === LAST_STEP ? getValues() : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(val) => {
        setOpen(val);
        if (!val) resetForm(); // also reset when closed from outside
      }}
    >
      <DialogContent
        className="bg-card sm:max-w-3xl"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Create Course</DialogTitle>
          <DialogDescription className="sr-only">
            Create a new course in five steps: details, schedule, faculty, options, then
            review.
          </DialogDescription>
        </DialogHeader>

        <Stepper
          steps={STEPS.map((s) => s.title)}
          current={step}
          onStepClick={(index) => setStep(index)}
          className="mb-2"
        />

        <form
          // Only the Review step may submit. Earlier steps swallow any submit that
          // slips through (backstop for the button-swap hazard handled below).
          onSubmit={step === LAST_STEP ? handleSubmit(onSubmit) : (e) => e.preventDefault()}
          className="space-y-4"
          onKeyDown={(e) => {
            // Enter advances the wizard instead of submitting a half-built course.
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
                      fieldProps={field}
                      error={errors.name?.message}
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
                      fieldProps={field}
                      placeholder="CMPSC 131"
                      error={errors.code?.message}
                      showStatus
                    />
                  )}
                />

                <div className="grid gap-4 md:grid-cols-2">
                  <Controller
                    control={control}
                    name="semester"
                    render={({ field }) => (
                      <InputGroup
                        label="Semester"
                        name="semester"
                        fieldProps={field}
                        placeholder={`Fall ${new Date().getFullYear()}`}
                        error={errors.semester?.message}
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
                        fieldProps={field}
                        min={1}
                        max={6}
                        step={1}
                        error={errors.credits?.message}
                      />
                    )}
                  />
                </div>
              </>
            )}

            {step === 1 && (
              <>
                {/* Timezone first: the dates below are interpreted in this zone. */}
                <Controller
                  control={control}
                  name="timezone"
                  render={({ field }) => (
                    <SelectField
                      label="Course timezone"
                      name="timezone"
                      id="timezone"
                      value={field.value ?? 'UTC'}
                      onValueChange={field.onChange}
                      options={COMMON_TIMEZONES.map((tz) => ({
                        value: tz,
                        label: formatTimezoneLabel(tz),
                      }))}
                      description="This timezone anchors the course's dates and every assignment due date for all students."
                      error={errors.timezone?.message}
                    />
                  )}
                />

                <div className="grid gap-4 md:grid-cols-2">
                  {/* START datetime-local (string) */}
                  <Controller
                    control={control}
                    name="startDate"
                    render={({ field }) => (
                      <InputGroup
                        label="Start Date & Time"
                        name="startDate"
                        type="datetime-local"
                        fieldProps={{
                          ...field,
                          value: field.value ?? '', // expect a string for datetime-local
                          onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
                            field.onChange(e.target.value),
                        }}
                        error={errors.startDate?.message}
                        requiredMark
                      />
                    )}
                  />

                  {/* END datetime-local (string) */}
                  <Controller
                    control={control}
                    name="endDate"
                    render={({ field }) => (
                      <InputGroup
                        label="End Date & Time"
                        name="endDate"
                        type="datetime-local"
                        fieldProps={{
                          ...field,
                          value: field.value ?? '',
                          onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
                            field.onChange(e.target.value),
                        }}
                        error={errors.endDate?.message}
                        min={startDateStr || undefined} // prevent picking an end earlier than start
                        requiredMark
                      />
                    )}
                  />
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <Controller
                    control={control}
                    name="registrationOpenAt"
                    render={({ field }) => (
                      <InputGroup
                        label="Self Registration Opens"
                        name="registrationOpenAt"
                        type="datetime-local"
                        fieldProps={{
                          ...field,
                          value: field.value ?? '',
                          onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
                            field.onChange(e.target.value),
                        }}
                        error={errors.registrationOpenAt?.message}
                        requiredMark
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
                        fieldProps={{
                          ...field,
                          value: field.value ?? '',
                          onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
                            field.onChange(e.target.value),
                        }}
                        error={errors.registrationCloseAt?.message}
                        requiredMark
                      />
                    )}
                  />
                </div>
              </>
            )}

            {step === 2 && (
              <>
              <Controller
                control={control}
                name="instructorIds"
                render={({ field }) => (
                  <SearchableMultiSelect
                    label="Assign Faculty"
                    items={facultyList.map((faculty) => ({
                      id: faculty.id,
                      label: getUserName(faculty),
                    }))}
                    value={field.value ?? []}
                    onChange={(value) => field.onChange(value)}
                    placeholder="Select faculty"
                    searchPlaceholder="Search faculty..."
                    emptyStateText="No faculty found."
                    error={errors.instructorIds?.message}
                  />
                )}
              />

              <Controller
                control={control}
                name="taIds"
                render={({ field }) => (
                  <SearchableMultiSelect
                    label="Assign TAs"
                    items={taList.map((ta) => ({
                      id: ta.id,
                      label: getUserName(ta),
                    }))}
                    value={field.value ?? []}
                    onChange={(value) => field.onChange(value)}
                    placeholder="Select TAs"
                    searchPlaceholder="Search TAs..."
                    emptyStateText="No TAs found."
                    error={errors.taIds?.message}
                  />
                )}
              />
              </>
            )}

            {step === 3 && (
              <Controller
                control={control}
                name="emptyStringNotation"
                render={({ field }) => (
                  <SelectField
                    label="Empty string notation"
                    name="emptyStringNotation"
                    id="emptyStringNotation"
                    value={field.value}
                    onValueChange={field.onChange}
                    options={EMPTY_STRING_NOTATION_OPTIONS}
                    description="Choose how the empty string should appear in automata and languages."
                    error={errors.emptyStringNotation?.message}
                  />
                )}
              />
            )}

            {step === LAST_STEP && review && (
              <div className="space-y-3">
                {/* min-w-0 + break-words keep long names/emails from overflowing
                    the dialog on narrow screens. */}
                <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm [&>dd]:min-w-0 [&>dd]:break-words">
                  <dt className="text-muted-foreground">Name</dt>
                  <dd className="font-medium">{review.name}</dd>
                  <dt className="text-muted-foreground">Code</dt>
                  <dd className="font-medium">
                    {review.code.trim().replace(/\s+/g, ' ').toUpperCase()}
                  </dd>
                  <dt className="text-muted-foreground">Semester</dt>
                  <dd>{review.semester}</dd>
                  <dt className="text-muted-foreground">Credits</dt>
                  <dd>{review.credits}</dd>
                  <dt className="text-muted-foreground">Timezone</dt>
                  <dd>{formatTimezoneLabel(review.timezone ?? 'UTC')}</dd>
                  <dt className="text-muted-foreground">Runs</dt>
                  <dd>
                    {formatLocal(review.startDate)} to {formatLocal(review.endDate)}
                  </dd>
                  <dt className="text-muted-foreground">Self registration</dt>
                  <dd>
                    {formatLocal(review.registrationOpenAt)} to{' '}
                    {formatLocal(review.registrationCloseAt)}
                  </dd>
                  <dt className="text-muted-foreground">Faculty</dt>
                  <dd>
                    {(review.instructorIds ?? [])
                      .map((id) => {
                        const f = facultyList.find((u) => u.id === id);
                        return f ? getUserName(f) : id;
                      })
                      .join(', ')}
                  </dd>
                  <dt className="text-muted-foreground">TAs</dt>
                  <dd>
                    {(review.taIds ?? [])
                      .map((id) => {
                        const ta = taList.find((u) => u.id === id);
                        return ta ? getUserName(ta) : id;
                      })
                      .join(', ') || 'None'}
                  </dd>
                  <dt className="text-muted-foreground">Empty string</dt>
                  <dd>
                    {EMPTY_STRING_NOTATION_OPTIONS.find(
                      (o) => o.value === review.emptyStringNotation,
                    )?.label ?? review.emptyStringNotation}
                  </dd>
                </dl>

                <p className="text-muted-foreground text-xs">
                  The course is created unpublished. Publish it when it&apos;s ready for
                  students.
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  // Clear touched/dirty/errors to avoid red flash on close
                  resetForm();
                }}
              >
                Cancel
              </Button>
            </DialogClose>

            {step > 0 && (
              <Button type="button" variant="secondary" onClick={back}>
                Back
              </Button>
            )}

            {/* Distinct keys force React to mount a NEW button node when Next becomes
                Create. Without them React reuses the clicked node and flips its type
                to "submit" while the click's default action is still pending, so
                reaching the Review step would submit the form immediately. */}
            {step < LAST_STEP ? (
              <Button key="wizard-next" type="button" onClick={() => void next()}>
                Next
              </Button>
            ) : (
              <Button key="wizard-create" type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Creating…' : 'Create Course'}
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

