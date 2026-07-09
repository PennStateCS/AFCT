'use client';

import React, { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import InputGroup from '@/components/ui/InputGroup';
import { Checkbox } from '@/components/ui/checkbox';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
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

type FormValues = z.infer<typeof DuplicateFormSchema>;

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
    mode: 'onBlur',
    reValidateMode: 'onChange',
  });

  const [step, setStep] = useState<number>(1);

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
    setConfirmChecked(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, course, timeZone]);

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

  type FieldName =
    | 'name'
    | 'code'
    | 'semester'
    | 'credits'
    | 'startDate'
    | 'endDate'
    | 'registrationOpenAt'
    | 'registrationCloseAt'
    | 'copyMode'
    | 'copyFaculty'
    | 'copyTAs';
  const fieldsForStep = (s: number): FieldName[] => {
    if (s === 1)
      return [
        'name',
        'code',
        'semester',
        'credits',
        'startDate',
        'endDate',
        'registrationOpenAt',
        'registrationCloseAt',
      ];
    if (s === 2) return ['copyMode', 'copyFaculty', 'copyTAs'];
    return [];
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) {
          reset(defaults);
          setStep(1);
        }
      }}
    >
      <DialogContent className="bg-card max-w-2xl">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Copy className="text-muted-foreground size-4" />
            <DialogTitle>Duplicate Course</DialogTitle>
          </div>
          <DialogDescription className="text-muted-foreground mt-1 text-sm">
            Step {step} of 3 -{' '}
            {step === 1 ? 'Course details' : step === 2 ? 'What to copy' : 'Roster copy options'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {step === 1 && (
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
                          Copy assignments and duplicate the problems attached to each assignment;
                          new assignments will reference copied problems only.
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

              <div className="space-y-3">
                <div className="text-sm">Choose roster copy options</div>
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
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-3">
              <div className="text-sm font-medium">Summary</div>
              <div className="grid grid-cols-1 gap-2 text-sm">
                {(() => {
                  const v = getValues();
                  const modeLabel =
                    v.copyMode === 'assignments'
                      ? 'Assignments only'
                      : v.copyMode === 'problems'
                        ? 'Problems only'
                        : 'Assignments and their problems';
                  return (
                    <>
                      <div>
                        <strong>Name:</strong> {v.name}
                      </div>
                      <div>
                        <strong>Code:</strong> {v.code}
                      </div>
                      <div>
                        <strong>Semester:</strong> {v.semester}
                      </div>
                      <div>
                        <strong>Dates:</strong> {v.startDate || '—'} to {v.endDate || '—'}
                      </div>
                      <div>
                        <strong>Self registration:</strong> {v.registrationOpenAt || '—'} to{' '}
                        {v.registrationCloseAt || '—'}
                      </div>
                      <div>
                        <strong>Credits:</strong> {v.credits}
                      </div>
                      <div>
                        <strong>Copy mode:</strong> {modeLabel}
                      </div>
                      <div>
                        <strong>Copy faculty roster:</strong> {v.copyFaculty ? 'Yes' : 'No'}
                      </div>
                      <div>
                        <strong>Copy TA roster:</strong> {v.copyTAs ? 'Yes' : 'No'}
                      </div>
                    </>
                  );
                })()}
              </div>

              <div className="text-muted-foreground pt-2 text-xs">
                The duplicated course will be created as unpublished and the current user will be
                added as faculty. Submissions will not be copied.
              </div>

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

          <DialogFooter>
            <DialogClose asChild>
              <Button
                type="button"
                variant="secondary"
                disabled={isSubmitting}
                onClick={() => {
                  setStep(1);
                  reset(defaults, { keepErrors: false });
                }}
              >
                Cancel
              </Button>
            </DialogClose>

            {step > 1 && (
              <Button
                type="button"
                variant="default"
                disabled={isSubmitting}
                onClick={() => setStep((s) => Math.max(1, s - 1))}
              >
                Back
              </Button>
            )}

            {step < 3 && (
              <Button
                type="button"
                disabled={isSubmitting}
                onClick={async () => {
                  const fields = fieldsForStep(step);
                  const valid = await trigger(fields);

                  if (valid) {
                    setConfirmChecked(false);
                    setStep((s) => Math.min(3, s + 1));
                  }
                }}
              >
                Next
              </Button>
            )}

            {step == 3 && (
              <Button type="submit" disabled={isSubmitting || !confirmChecked}>
                {isSubmitting ? 'Copying…' : 'Duplicate Course'}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
