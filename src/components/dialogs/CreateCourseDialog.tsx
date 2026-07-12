'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Stepper } from '@/components/ui/stepper';
import type { User } from '@prisma/client';
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
  { title: 'Faculty', fields: ['instructorIds'] },
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

  // Fetch faculty list when dialog opens. Shared cache entry (identical query
  // key) with EditCourseDialog so the two dedupe onto one request.
  const facultyQuery = useQuery({
    queryKey: ['admin', 'users', 'faculty'],
    queryFn: async () => {
      const res = await fetch(apiPaths.admin.users({ role: 'FACULTY' }));
      if (!res.ok) throw new Error('Failed to load faculty');
      const data = await res.json();
      return (Array.isArray(data) ? data : []) as Array<User & { role?: string }>;
    },
    enabled: open,
    staleTime: 30_000,
  });
  const facultyList = facultyQuery.data ?? [];
  useEffect(() => {
    if (facultyQuery.isError) toast.error('Failed to load faculty list.');
  }, [facultyQuery.isError]);

  const facultyName = (user: User) =>
    `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || user.email || 'Unknown user';

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

    const res = await fetch(apiPaths.courses(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      toast.success('Course created successfully');
      resetForm();
      setOpen(false);
      onSuccess?.();
    } else {
      const msg = await safeMessage(res);
      toast.error(msg ?? 'Failed to create course');
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
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Create Course</DialogTitle>
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
              <Controller
                control={control}
                name="instructorIds"
                render={({ field }) => (
                  <SearchableMultiSelect
                    label="Assign Faculty"
                    items={facultyList.map((faculty) => ({
                      id: faculty.id,
                      label: facultyName(faculty),
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
                        return f ? facultyName(f) : id;
                      })
                      .join(', ')}
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

async function safeMessage(res: Response) {
  try {
    const data = await res.json();
    return data?.message ?? null;
  } catch {
    return null;
  }
}
