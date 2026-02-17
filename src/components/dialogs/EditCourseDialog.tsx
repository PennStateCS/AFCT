'use client';

import React from 'react';

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
import { Course, User } from '@prisma/client';
import { useEffect, useMemo, useState } from 'react';
import InputGroup from '@/components/ui/InputGroup';
import { Switch } from '@/components/ui/switch';
import { SearchableMultiSelect } from '@/components/ui/SearchableMultiSelect';

import { useForm, Controller } from 'react-hook-form';
import { showToast } from '@/lib/toast';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { CourseFormSchema } from '@/schemas/course';
import { toast } from 'sonner';
import { getInstructors, EnrolledUser } from '@/lib/course-utils';

type EditCourseDialogProps = {
  course: Course & { enrolled?: EnrolledUser[] };
  open: boolean;
  setOpen: (open: boolean) => void;
  onSave?: (updatedCourse: Partial<Course>) => void;
  timeZone: string;
};

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

export function EditCourseDialog({
  course,
  open,
  setOpen,
  onSave,
  timeZone,
}: EditCourseDialogProps) {
  const defaultValues: FormValues = useMemo(
    () => ({
      name: course.name ?? '',
      code: course.code ?? '',
      semester: course.semester ?? '',
      credits: String(course.credits ?? 3),
      startDate: toDateTimeLocalInTimeZone(course.startDate, timeZone),
      endDate: toDateTimeLocalInTimeZone(course.endDate, timeZone),
      registrationOpenAt: course.registrationOpenAt
        ? toDateTimeLocalInTimeZone(course.registrationOpenAt, timeZone)
        : '',
      registrationCloseAt: course.registrationCloseAt
        ? toDateTimeLocalInTimeZone(course.registrationCloseAt, timeZone)
        : '',
      isPublished: course.isPublished ?? false,
      isArchived: course.isArchived ?? false,
      instructorIds: getInstructors(course.enrolled).map((u) => u.id),
    }),
    [course, timeZone],
  );

  const {
    control,
    handleSubmit,
    reset,
    watch,
    formState: { isDirty, isValid, errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(CourseFormSchema),
    defaultValues,
    mode: 'onBlur',
    reValidateMode: 'onChange',
  });

  // Keep min (end) in sync with start
  const startDateStr = watch('startDate');

  const [facultyList, setFacultyList] = useState<User[]>([]);

  useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        const res = await fetch('/api/users?role=FACULTY');
        if (!res.ok) throw new Error('Failed to load faculty');
        const data = await res.json();
        setFacultyList((Array.isArray(data) ? data : []).filter((user) => user.role === 'FACULTY'));
      } catch {
        toast.error('Failed to load faculty list.');
      }
    })();
  }, [open]);

  // Reset to current course when opened; also clear on close from outside
  useEffect(() => {
    if (open) {
      reset(defaultValues, { keepDirty: false, keepTouched: false });
    }
  }, [open, defaultValues, reset]);

  const onSubmit = async (raw: FormValues) => {
    // Convert form values to the format expected by the API
    const payload: Record<string, unknown> = {
      id: course.id,
      ...raw,
      credits: Number(raw.credits), // Convert string to number
      code: raw.code.trim().replace(/\s+/g, ' ').toUpperCase(), // Normalize code
    };

    try {
      const res = await fetch(`/api/courses/${course.id}`, {
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
      reset(defaultValues, {
        keepDirty: false,
        keepTouched: false,
        keepErrors: false,
        keepValues: false,
      });
      onSave?.(updated);
      setOpen(false);
    } catch (err) {
      // network or fetch error
      console.error('[PUT] error', err);
      showToast.error(`Network error editing course: ${(err as Error).message || err}`);
    }
  };

  const onSubmitWrapper = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    handleSubmit((data) => onSubmit(data as unknown as FormValues))(e);
  };

  const resetForm = () =>
    reset(defaultValues, {
      keepDirty: false,
      keepTouched: false,
      keepErrors: false,
      keepValues: false,
    });

  return (
    <Dialog
      open={open}
      onOpenChange={(val) => {
        setOpen(val);
        if (!val) resetForm();
      }}
    >
      <DialogContent className="bg-card">
        <DialogHeader>
          <DialogTitle>Edit Course</DialogTitle>
          <DialogDescription>Update the course details and save your changes.</DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={onSubmitWrapper}>
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

          {/* PUBLISH STATUS TOGGLE */}
          <Controller
            name="isPublished"
            control={control}
            render={({ field }) => (
              <div className="flex items-center justify-between">
                <label
                  className="pb-2 text-sm leading-none font-medium select-none"
                  htmlFor="isPublished-switch"
                >
                  Published
                </label>
                <Switch
                  id="isPublished-switch"
                  checked={field.value}
                  onCheckedChange={field.onChange}
                  aria-label="Published"
                />
              </div>
            )}
          />

          {/* ARCHIVE STATUS TOGGLE */}
          <Controller
            name="isArchived"
            control={control}
            render={({ field }) => (
              <div className="flex items-center justify-between">
                <label
                  className="pb-2 text-sm leading-none font-medium select-none"
                  htmlFor="isArchived-switch"
                >
                  Archived
                </label>
                <Switch
                  id="isArchived-switch"
                  checked={field.value}
                  onCheckedChange={field.onChange}
                  aria-label="Archived"
                />
              </div>
            )}
          />

          <DialogFooter className="mt-4">
            <DialogClose asChild>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  // Clear touched/dirty/errors before closing to prevent red flash
                  resetForm();
                }}
              >
                Cancel
              </Button>
            </DialogClose>
            <Button
              type="submit"
              disabled={!isValid || !isDirty || isSubmitting || course.isArchived}
              title={
                !isValid
                  ? 'Fix validation errors to save'
                  : !isDirty
                    ? 'No changes to save'
                    : 'Course is not archived'
              }
            >
              {isSubmitting ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
