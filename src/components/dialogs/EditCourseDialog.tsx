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
import { Course } from '@prisma/client';
import { useEffect, useMemo } from 'react';
import InputGroup from '@/components/ui/InputGroup';

import { useForm, Controller } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { CourseFormSchema, UpdateCourseSchema } from '@/schemas/course';

type EditCourseDialogProps = {
  course: Course;
  open: boolean;
  setOpen: (open: boolean) => void;
  onSave?: (updatedCourse: Partial<Course>) => void;
};

function toDateTimeLocalString(date: Date | string): string {
  const d = new Date(date);
  const offset = d.getTimezoneOffset();
  const localDate = new Date(d.getTime() - offset * 60000);
  return localDate.toISOString().slice(0, 16);
}

// RHF form state before transforms (strings for datetime-local)
type FormValues = z.infer<typeof CourseFormSchema>;

export function EditCourseDialog({ course, open, setOpen, onSave }: EditCourseDialogProps) {
  const defaultValues: FormValues = useMemo(
    () => ({
      name: course.name ?? '',
      code: course.code ?? '',
      semester: course.semester ?? '',
      credits: String(course.credits ?? 3),
      startDate: toDateTimeLocalString(course.startDate),
      endDate: toDateTimeLocalString(course.endDate),
    }),
    [course],
  );

  const {
    control,
    handleSubmit,
    reset,
    watch,
    formState: { isDirty, isValid, errors },
  } = useForm<FormValues>({
    resolver: zodResolver(CourseFormSchema),
    defaultValues,
    mode: 'onBlur',
    reValidateMode: 'onChange',
  });

  // Keep min (end) in sync with start
  const startDateStr = watch('startDate');

  // Reset to current course when opened; also clear on close from outside
  useEffect(() => {
    if (open) {
      reset(defaultValues, { keepDirty: false, keepTouched: false });
    }
  }, [open, defaultValues, reset]);

  const onSubmit = (raw: FormValues) => {
    // Convert form values to the format expected by the API
    const formData = {
      ...raw,
      credits: Number(raw.credits), // Convert string to number
      code: raw.code.trim().replace(/\s+/g, ' ').toUpperCase(), // Normalize code
    };

    const payload = UpdateCourseSchema.parse({ id: course.id, ...formData });

    onSave?.({
      ...course,
      name: payload.name,
      code: payload.code,
      semester: payload.semester,
      credits: Number(payload.credits),
      startDate: payload.startDate,
      endDate: payload.endDate,
    });
    // Optional: reset before close to avoid any flicker
    reset(defaultValues, {
      keepDirty: false,
      keepTouched: false,
      keepErrors: false,
      keepValues: false,
    });
    setOpen(false);
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

          {/* SEMESTER */}
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

          {/* CREDITS */}
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

          {/* START datetime-local (string) */}
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
              />
            )}
          />

          {/* END datetime-local (string) */}
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
              />
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
              disabled={!isValid || !isDirty || course.isArchived}
              title={
                !isValid
                  ? 'Fix validation errors to save'
                  : !isDirty
                    ? 'No changes to save'
                    : "Course is not archived"
              }
            >
              Save Changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
