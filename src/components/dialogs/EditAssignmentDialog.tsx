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
import { Label } from '@/components/ui/label';
import { Assignment } from '@prisma/client';
import SwitchField from '@/components/ui/SwitchField';
import { Textarea } from '@/components/ui/textarea';
import InputGroup from '@/components/ui/InputGroup';

import { useEffect, useMemo } from 'react';

import { useForm, Controller } from 'react-hook-form';
import { showToast } from '@/lib/toast';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';

import {
  AssignmentFormSchema, // form-only schema (title, description, dueDate, courseId)
  UpdateAssignmentSchema, // partial + id + publish rule
} from '@/schemas/assignment';

// Convert Date → "YYYY-MM-DDTHH:MM" for <input type="datetime-local"> in a timezone
function toDateTimeLocalInTimeZone(date: Date | string, timeZone: string): string {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '';
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

function nowLocalString(timeZone: string): string {
  return toDateTimeLocalInTimeZone(new Date(), timeZone);
}

type EditAssignmentDialogProps = {
  courseIsArchived: boolean;
  assignment: Assignment;
  open: boolean;
  setOpen: (open: boolean) => void;
  timeZone: string;
  onSave?: (updated: Assignment) => void;
};

// RHF state BEFORE Zod transforms (string for datetime-local, etc.)
type FormValues = z.infer<typeof AssignmentFormSchema>;

export function EditAssignmentDialog({
  courseIsArchived,
  assignment,
  open,
  setOpen,
  timeZone,
  onSave,
}: EditAssignmentDialogProps) {
  const assignmentDueDateString = useMemo(
    () => toDateTimeLocalInTimeZone(assignment.dueDate, timeZone),
    [assignment.dueDate, timeZone],
  );

  const assignmentLateCutoffString = useMemo(
    () =>
      assignment.lateCutoff
        ? toDateTimeLocalInTimeZone(assignment.lateCutoff, timeZone)
        : undefined,
    [assignment.lateCutoff, timeZone],
  );

  const defaultValues: FormValues = useMemo(
    () => ({
      title: assignment.title ?? '',
      description: assignment.description ?? '',
      dueDate: assignmentDueDateString, // string for input
      allowLateSubmissions: assignment.allowLateSubmissions ?? false,
      lateCutoff: assignmentLateCutoffString,
      isPublished: assignment.isPublished ?? false,
      isGroup: assignment.isGroup ?? false,
      courseId: assignment.courseId,
    }),
    [
      assignment.allowLateSubmissions,
      assignment.courseId,
      assignment.description,
      assignment.isGroup,
      assignment.isPublished,
      assignment.title,
      assignmentDueDateString,
      assignmentLateCutoffString,
    ],
  );

  const {
    control,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors, isValid, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(AssignmentFormSchema),
    defaultValues,
    mode: 'onBlur',
    reValidateMode: 'onChange',
  });

  const allowLateSubmissions = watch('allowLateSubmissions');
  const dueDateValue = watch('dueDate');
  const lateCutoffValue = watch('lateCutoff');

  useEffect(() => {
    if (!allowLateSubmissions) {
      setValue('lateCutoff', undefined, {
        shouldValidate: true,
        shouldDirty: false,
      });
    }
  }, [allowLateSubmissions, setValue]);

  useEffect(() => {
    if (allowLateSubmissions && !lateCutoffValue) {
      setValue(
        'lateCutoff',
        dueDateValue ??
          assignmentLateCutoffString ??
          assignmentDueDateString ??
          nowLocalString(timeZone),
        {
          shouldValidate: true,
          shouldDirty: false,
        },
      );
    }
  }, [
    allowLateSubmissions,
    assignmentDueDateString,
    assignmentLateCutoffString,
    dueDateValue,
    lateCutoffValue,
    setValue,
    timeZone,
  ]);

  // Keep publish state separate since it's not part of form schema
  // Reset on open/close (prevents error/touched flicker)
  useEffect(() => {
    if (open) {
      reset(defaultValues, {
        keepDirty: false,
        keepTouched: false,
        keepErrors: false,
        keepValues: true,
      });
    } else {
      reset(defaultValues, {
        keepDirty: false,
        keepTouched: false,
        keepErrors: false,
        keepValues: false,
      });
    }
  }, [open, defaultValues, reset]);

  const resetForm = () => {
    reset(defaultValues, {
      keepDirty: false,
      keepTouched: false,
      keepErrors: false,
      keepValues: false,
    });
  };

  const onSubmit = async (raw: FormValues) => {
    // Use the update schema with form values (keep strings as strings)
    const payload = UpdateAssignmentSchema.parse({
      id: assignment.id,
      ...raw,
    });

    const preparedPayload = {
      ...payload,
      lateCutoff: payload.allowLateSubmissions ? payload.lateCutoff : null,
    };

    try {
      const res = await fetch(`/api/assignments/${assignment.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...preparedPayload,
          dueDate: preparedPayload.dueDate,
          isGroup: preparedPayload.isGroup ?? false,
        }),
      });
      if (!res.ok) {
        // try to read message from server
        const data = await res.json().catch(() => ({}));
        const msg = data?.error || data?.message || `Server returned ${res.status}`;
        showToast.error(msg || 'Failed to edit assignment');
        console.error('[DELETE] server error', msg, data);
        return;
      }

      const updated = (await res.json()) as Assignment;
      // reset before closing to avoid any flash
      resetForm();
      onSave?.(updated);
      setOpen(false);
    } catch (err) {
      // network or fetch error
      console.error('[PUT] error', err);
      showToast.error(`Network error editing assignment: ${(err as Error).message || err}`);
    }
  };

  const onSubmitWrapper = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    handleSubmit((data) => onSubmit(data as unknown as FormValues))(e);
  };

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
          <DialogTitle>Edit Assignment</DialogTitle>
          <DialogDescription>
            Update the assignment details and save your changes.
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={onSubmitWrapper}>
          {/* Title */}
          <Controller
            name="title"
            control={control}
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

          {/* Description (Textarea) */}
          <Controller
            name="description"
            control={control}
            render={({ field }) => (
              <div>
                <Label className="mb-2 block">Description</Label>
                <Textarea
                  {...field}
                  value={field.value ?? ''}
                  placeholder="Enter assignment description"
                  className="min-h-[100px]"
                />
                {errors.description && (
                  <p className="mt-1 text-xs text-red-600">{errors.description.message}</p>
                )}
              </div>
            )}
          />

          {/* Due Date */}
          <Controller
            name="dueDate"
            control={control}
            render={({ field }) => (
              <InputGroup
                label="Due Date & Time"
                name="dueDate"
                type="datetime-local"
                fieldProps={{
                  ...field,
                  value: field.value ?? '',
                  onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
                    field.onChange(e.target.value),
                }}
                error={errors.dueDate?.message}
              />
            )}
          />

          {/* Is a group assignment switch */}
          <Controller
            name="isGroup"
            control={control}
            render={({ field }) => (
              <SwitchField
                label="Group Assignment"
                name="isGroup"
                checked={!!field.value}
                onCheckedChange={(checked) => field.onChange(!!checked)}
                description="Students submit and are graded as groups for this assignment."
                descriptionPlacement="inline"
              />
            )}
          />

          {/* Published switch (kept outside the form schema) */}
          {/* Published switch (controlled by RHF) */}
          <Controller
            name="isPublished"
            control={control}
            render={({ field }) => (
              <SwitchField
                label="Publish Now"
                name="isPublished"
                checked={!!field.value}
                onCheckedChange={(checked) => field.onChange(!!checked)}
                description="Makes the assignment visible to enrolled students."
                descriptionPlacement="inline"
              />
            )}
          />

          {/* Late submissions toggle */}
          <Controller
            name="allowLateSubmissions"
            control={control}
            render={({ field }) => (
              <SwitchField
                label="Allow Late Submissions"
                name="allowLateSubmissions"
                checked={!!field.value}
                onCheckedChange={(checked) => field.onChange(!!checked)}
                description="Students can submit after the deadline until a cutoff date."
                descriptionPlacement="inline"
              />
            )}
          />

          {allowLateSubmissions && (
            <Controller
              name="lateCutoff"
              control={control}
              render={({ field }) => (
                <InputGroup
                  label="Late Submission Cutoff"
                  name="lateCutoff"
                  type="datetime-local"
                  fieldProps={{
                    ...field,
                    value: field.value ?? '',
                    onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
                      field.onChange(e.target.value),
                  }}
                  min={dueDateValue ?? nowLocalString(timeZone)}
                  error={errors.lateCutoff?.message}
                />
              )}
            />
          )}

          <DialogFooter className="mt-4">
            <DialogClose asChild>
              <Button
                type="button"
                variant="secondary"
                onClick={resetForm} // clear touched/dirty/errors before closing
                disabled={isSubmitting}
              >
                Cancel
              </Button>
            </DialogClose>
            <Button
              type="submit"
              disabled={!isValid || isSubmitting || courseIsArchived}
              title={
                !isValid
                  ? 'Fix validation errors to save'
                    : isSubmitting
                      ? 'Already submitting'
                      : courseIsArchived
                        ? 'Course is archived'
                        : undefined
              }
            >
              {isSubmitting ? 'Saving…' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

