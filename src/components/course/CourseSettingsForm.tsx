'use client';

import React, { useEffect, useMemo } from 'react';

import { useQuery } from '@tanstack/react-query';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import type { z } from 'zod';
import type { Course, User } from '@prisma/client';

import { Button } from '@/components/ui/button';
import InputGroup from '@/components/ui/InputGroup';
import SelectField from '@/components/ui/SelectField';
import SwitchField from '@/components/ui/SwitchField';
import { SearchableMultiSelect } from '@/components/ui/SearchableMultiSelect';
import { EMPTY_STRING_NOTATION_OPTIONS } from '@/lib/empty-string-notation';
import { COMMON_TIMEZONES, formatTimezoneLabel } from '@/lib/timezones';
import { showToast } from '@/lib/toast';
import { CourseFormSchema } from '@/schemas/course';
import type { EnrolledUser } from '@/lib/course-utils';
import { getInstructors } from '@/lib/course-utils';
import { apiPaths } from '@/lib/api-paths';
import { cn } from '@/lib/utils';

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

// RHF form state before transforms (strings for datetime-local)
type FormValues = z.infer<typeof CourseFormSchema>;

type CourseSettingsFormProps = {
  course: Course & { enrolled?: EnrolledUser[] };
  /** Called with the server's updated course after a successful save. */
  onSaved?: (updated: Partial<Course>) => void;
  /** When provided, renders a Cancel button (e.g. inside the edit dialog). */
  onCancel?: () => void;
  className?: string;
};

/**
 * The course settings form — every editable course field plus a Save button.
 * Rendered inline on the course Settings tab and inside {@link EditCourseDialog}.
 */
export function CourseSettingsForm({
  course,
  onSaved,
  onCancel,
  className,
}: CourseSettingsFormProps) {
  // A course's dates/deadlines are anchored to the course's OWN timezone — display and
  // interpret the datetime-local fields in it (not the viewer's), so what staff see is
  // exactly what the server stores.
  const courseTz = course.timezone || 'UTC';

  const defaultValues: FormValues = useMemo(
    () => ({
      name: course.name ?? '',
      code: course.code ?? '',
      semester: course.semester ?? '',
      credits: String(course.credits ?? 3),
      startDate: toDateTimeLocalInTimeZone(course.startDate, courseTz),
      endDate: toDateTimeLocalInTimeZone(course.endDate, courseTz),
      registrationOpenAt: course.registrationOpenAt
        ? toDateTimeLocalInTimeZone(course.registrationOpenAt, courseTz)
        : '',
      registrationCloseAt: course.registrationCloseAt
        ? toDateTimeLocalInTimeZone(course.registrationCloseAt, courseTz)
        : '',
      isPublished: course.isPublished ?? false,
      isArchived: course.isArchived ?? false,
      instructorIds: getInstructors(course.enrolled).map((u) => u.id),
      emptyStringNotation: course.emptyStringNotation ?? 'EPSILON',
      timezone: courseTz,
    }),
    [course, courseTz],
  );

  const {
    control,
    handleSubmit,
    reset,
    watch,
    formState: { isValid, errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(CourseFormSchema),
    defaultValues,
    mode: 'onBlur',
    reValidateMode: 'onChange',
  });

  // Keep min (end) in sync with start
  const startDateStr = watch('startDate');

  // Fetch faculty list. Shared cache entry (identical query key) with
  // CreateCourseDialog/EditCourseDialog so callers dedupe onto one request.
  const facultyQuery = useQuery({
    queryKey: ['admin', 'users', 'faculty'],
    queryFn: async () => {
      const res = await fetch(apiPaths.admin.users({ role: 'FACULTY' }));
      if (!res.ok) throw new Error('Failed to load faculty');
      const data = await res.json();
      return (Array.isArray(data) ? data : []) as Array<User & { role?: string }>;
    },
    staleTime: 30_000,
  });
  const facultyList = (facultyQuery.data ?? []).filter((user) => user.role === 'FACULTY');
  useEffect(() => {
    if (facultyQuery.isError) toast.error('Failed to load faculty list.');
  }, [facultyQuery.isError]);

  // Re-sync the form whenever the underlying course changes (e.g. after a save
  // merges the server response back into state).
  useEffect(() => {
    reset(defaultValues, { keepDirty: false, keepTouched: false });
  }, [defaultValues, reset]);

  const onSubmit = async (raw: FormValues) => {
    const payload: Record<string, unknown> = {
      id: course.id,
      ...raw,
      credits: Number(raw.credits), // Convert string to number
      code: raw.code.trim().replace(/\s+/g, ' ').toUpperCase(), // Normalize code
    };

    try {
      const res = await fetch(apiPaths.course(course.id), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const msg = data?.error || data?.message || `Server returned ${res.status}`;
        showToast.error(msg || 'Failed to edit course');
        console.error('[COURSE UPDATE] server error', msg, data);
        return;
      }
      const updated = await res.json();
      reset(raw, { keepDirty: false, keepTouched: false, keepErrors: false });
      onSaved?.(updated);
    } catch (err) {
      console.error('[PUT] error', err);
      showToast.error(`Network error editing course: ${(err as Error).message || err}`);
    }
  };

  const onSubmitWrapper = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    void handleSubmit((data) => onSubmit(data as unknown as FormValues))(e);
  };

  const resetForm = () =>
    reset(defaultValues, {
      keepDirty: false,
      keepTouched: false,
      keepErrors: false,
      keepValues: false,
    });

  return (
    <form className={cn('space-y-4', className)} onSubmit={onSubmitWrapper}>
      {/* NAME */}
      <Controller
        name="name"
        control={control}
        render={({ field }) => (
          <InputGroup
            name="name"
            label="Course Name"
            fieldProps={field}
            error={errors.name?.message}
          />
        )}
      />

      {/* CODE */}
      <Controller
        name="code"
        control={control}
        render={({ field }) => (
          <InputGroup
            name="code"
            label="Course Code"
            fieldProps={field}
            placeholder="e.g., CMPSC 221"
            error={errors.code?.message}
            showStatus
            isValid={!errors.code && !!field.value}
          />
        )}
      />

      <div className="grid gap-4 md:grid-cols-2">
        <Controller
          name="semester"
          control={control}
          render={({ field }) => (
            <InputGroup
              name="semester"
              label="Semester"
              fieldProps={field}
              placeholder="Fall 2025"
              error={errors.semester?.message}
            />
          )}
        />

        <Controller
          name="credits"
          control={control}
          render={({ field }) => (
            <InputGroup
              name="credits"
              label="Credits"
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

      {/* COURSE TIMEZONE — anchors all the course's deadlines */}
      <Controller
        name="timezone"
        control={control}
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
            description="The dates below — and every assignment due date — are interpreted in this timezone for all students."
            error={errors.timezone?.message}
          />
        )}
      />

      <div className="grid gap-4 md:grid-cols-2">
        <Controller
          name="startDate"
          control={control}
          render={({ field }) => (
            <InputGroup
              name="startDate"
              label="Start Date & Time"
              type="datetime-local"
              fieldProps={{
                ...field,
                value: field.value ?? '',
                onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
                  field.onChange(e.target.value),
              }}
              error={errors.startDate?.message}
              requiredMark
            />
          )}
        />

        <Controller
          name="endDate"
          control={control}
          render={({ field }) => (
            <InputGroup
              name="endDate"
              label="End Date & Time"
              type="datetime-local"
              fieldProps={{
                ...field,
                value: field.value ?? '',
                onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
                  field.onChange(e.target.value),
              }}
              error={errors.endDate?.message}
              min={startDateStr || undefined}
              requiredMark
            />
          )}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Controller
          name="registrationOpenAt"
          control={control}
          render={({ field }) => (
            <InputGroup
              name="registrationOpenAt"
              label="Self Registration Opens"
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
          name="registrationCloseAt"
          control={control}
          render={({ field }) => (
            <InputGroup
              name="registrationCloseAt"
              label="Self Registration Closes"
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

      <Controller
        control={control}
        name="instructorIds"
        render={({ field }) => (
          <SearchableMultiSelect
            label="Assign Faculty"
            items={facultyList.map((faculty) => ({
              id: faculty.id,
              label:
                `${faculty.firstName ?? ''} ${faculty.lastName ?? ''}`.trim() ||
                faculty.email ||
                'Unknown user',
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

      {/* EMPTY STRING NOTATION */}
      <Controller
        name="emptyStringNotation"
        control={control}
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

      {/* PUBLISH STATUS TOGGLE */}
      <Controller
        name="isPublished"
        control={control}
        render={({ field }) => (
          <SwitchField
            label="Published"
            name="isPublished-switch"
            checked={!!field.value}
            onCheckedChange={(checked) => field.onChange(!!checked)}
          />
        )}
      />

      {/* ARCHIVE STATUS TOGGLE */}
      <Controller
        name="isArchived"
        control={control}
        render={({ field }) => (
          <SwitchField
            label="Archived"
            name="isArchived-switch"
            checked={!!field.value}
            onCheckedChange={(checked) => field.onChange(!!checked)}
          />
        )}
      />

      <div className="flex justify-end gap-2 pt-2">
        {onCancel ? (
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              // Clear touched/dirty/errors before closing to prevent red flash
              resetForm();
              onCancel();
            }}
          >
            Cancel
          </Button>
        ) : null}
        <Button
          type="submit"
          disabled={!isValid || isSubmitting || course.isArchived}
          title={
            course.isArchived
              ? 'Unarchive the course to make changes'
              : !isValid
                ? 'Fix validation errors to save'
                : 'Save changes'
          }
        >
          {isSubmitting ? 'Saving...' : 'Save Changes'}
        </Button>
      </div>
    </form>
  );
}
