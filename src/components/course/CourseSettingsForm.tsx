'use client';

import React, { useEffect, useMemo } from 'react';

import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import type { Course } from '@prisma/client';

import { Button } from '@/components/ui/button';
import InputGroup from '@/components/ui/InputGroup';
import SelectField from '@/components/ui/SelectField';
import { SettingsSection } from '@/components/settings/settings-layout';
import { EMPTY_STRING_NOTATION_OPTIONS } from '@/lib/empty-string-notation';
import { COMMON_TIMEZONES, formatTimezoneLabel } from '@/lib/timezones';
import { showToast } from '@/lib/toast';
import { CourseFormSchema } from '@/schemas/course';
import type { EnrolledUser } from '@/lib/course-roster';
import { apiPaths } from '@/lib/api-paths';
import { cn } from '@/lib/utils';
import { toDateTimeLocalInTimeZone } from '@/lib/date-convert';

// RHF form state before transforms (strings for datetime-local)
type FormValues = z.input<typeof CourseFormSchema>;

type CourseSettingsFormProps = {
  course: Course & { enrolled?: EnrolledUser[] };
  /** Called with the server's updated course after a successful save. */
  onSaved?: (updated: Partial<Course>) => void;
  className?: string;
};

/**
 * The course settings form: every editable course field plus a Save footer.
 *
 * Grouped into the same titled panels System Settings uses, through the shared
 * `SettingsSection`, rather than as one 11-field column. Course setup is four unrelated
 * decisions (what the course is called, when it runs, when students may enrol themselves,
 * and how it is displayed to them), and running them together meant the only thing telling
 * "End Date & Time" from "Self Registration Closes" was reading both labels. The sections
 * are h3: the tab already contributes the "Course Settings" h2 above them.
 */
export function CourseSettingsForm({ course, onSaved, className }: CourseSettingsFormProps) {
  // A course's dates/deadlines are anchored to the course's OWN timezone; display and
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

  return (
    // space-y-5, the same gap System Settings puts between its panels, and no max-width of
    // its own: the column this sits in is set by the tab's SettingsAsideLayout, so the form
    // and the status card beside it agree by construction rather than by two numbers.
    <form className={cn('space-y-5', className)} onSubmit={onSubmitWrapper}>
      <SettingsSection
        title="Course details"
        description="What the course is called, and how it is identified."
        headingLevel={3}
      >
        <Controller
          name="name"
          control={control}
          render={({ field }) => (
            <InputGroup
              name="name"
              label="Course Name"
              fieldProps={field}
              description="The full title students see for this course."
              error={errors.name?.message}
            />
          )}
        />

        <Controller
          name="code"
          control={control}
          render={({ field }) => (
            <InputGroup
              name="code"
              label="Course Code"
              fieldProps={field}
              placeholder="e.g., CMPSC 221"
              description="A short identifier for the course. It's normalized to uppercase when saved."
              error={errors.code?.message}
              showStatus
              isValid={!errors.code && !!field.value}
            />
          )}
        />

        {/* Two short values, so two columns: a credit count is one digit, and a field the
            width of the panel for it reads as a mistake. */}
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
                description="The term this course runs in."
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
                description="Number of credit hours (1-6)."
                error={errors.credits?.message}
              />
            )}
          />
        </div>
      </SettingsSection>

      {/* The timezone leads this panel rather than sitting with the name and code, because
          it is what the two dates under it mean. Read in the other order, a professor sets
          a start date and only afterwards learns which clock it was in. */}
      <SettingsSection
        title="Dates and timezone"
        description="When the course runs, and the clock its deadlines are read in."
        headingLevel={3}
      >
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
              description="The dates below, and every assignment due date, are interpreted in this timezone for all students."
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
                description="When the course begins, in the course timezone above."
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
                description="When the course ends. Must be on or after the start date."
                error={errors.endDate?.message}
                min={startDateStr || undefined}
                requiredMark
              />
            )}
          />
        </div>
      </SettingsSection>

      <SettingsSection
        title="Self registration"
        description="The window in which students may enrol themselves with the course's registration code."
        headingLevel={3}
      >
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
                description="When students may start self-enrolling with the registration code."
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
                description="After this time, self-registration is closed."
                error={errors.registrationCloseAt?.message}
                requiredMark
              />
            )}
          />
        </div>
      </SettingsSection>

      <SettingsSection
        title="Notation"
        description="How this course's automata and languages are written."
        headingLevel={3}
      >
        {/* A medium column: the longest option is a few words, and a select stretched
            across the panel reads as a mistake. Same call GeneralTab makes for timezone. */}
        <div className="max-w-md">
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
        </div>
      </SettingsSection>

      {/* The same footer System Settings uses: a rule, then the action at the right edge of
          the form it saves. */}
      <div className="flex flex-wrap items-center justify-end gap-3 border-t pt-4">
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
