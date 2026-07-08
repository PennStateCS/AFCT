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
import SwitchField from '@/components/ui/SwitchField';
import { Textarea } from '@/components/ui/textarea';
import InputGroup from '@/components/ui/InputGroup';

import { useEffect, useMemo } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

// ✅ Import assignment schemas directly to avoid barrel/cycle issues
import { CreateAssignmentFormSchema } from '@/schemas/assignment';
import { apiPaths } from '@/lib/api-paths';

type FormValues = z.infer<typeof CreateAssignmentFormSchema>; // strings for datetime-local

import { Assignment } from '@prisma/client';

type CreateAssignmentDialogProps = {
  open: boolean;
  setOpen: (open: boolean) => void;
  courseId: string;
  courseIsArchived: boolean;
  timeZone: string;
  onCreate?: (assignment: Assignment) => void;
};

function toDateTimeLocalInTimeZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
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

// Default to “today at 23:59” in the user's timezone
function defaultDueLocalString(timeZone: string): string {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const year = lookup.year ?? '0000';
  const month = lookup.month ?? '01';
  const day = lookup.day ?? '01';
  return `${year}-${month}-${day}T23:59`;
}

export function CreateAssignmentDialog({
  open,
  setOpen,
  courseId,
  courseIsArchived,
  timeZone,
  onCreate,
}: CreateAssignmentDialogProps) {
  // Form defaults (strings for datetime-local fields)
  const defaults: FormValues = useMemo(
    () => ({
      title: '',
      description: '',
      dueDate: defaultDueLocalString(timeZone),
      allowLateSubmissions: false,
      lateCutoff: undefined,
      isPublished: false,
      isGroup: false,
      courseId: courseId,
    }),
    [courseId, timeZone],
  );

  const {
    control,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors, isSubmitting, isValid },
  } = useForm<FormValues>({
    resolver: zodResolver(CreateAssignmentFormSchema),
    defaultValues: defaults,
    mode: 'onChange',
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
      setValue('lateCutoff', dueDateValue ?? defaultDueLocalString(timeZone), {
        shouldValidate: true,
        shouldDirty: false,
      });
    }
  }, [allowLateSubmissions, dueDateValue, lateCutoffValue, setValue, timeZone]);

  // Refresh defaults on open; also clear state on close to avoid flicker
  useEffect(() => {
    if (open) {
      reset(defaults, {
        keepDirty: false,
        keepTouched: false,
        keepErrors: false,
        keepValues: false,
      });
    } else {
      reset(defaults, {
        keepDirty: false,
        keepTouched: false,
        keepErrors: false,
        keepValues: false,
      });
    }
  }, [open, defaults, reset]);

  const resetForm = () =>
    reset(defaults, {
      keepDirty: false,
      keepTouched: false,
      keepErrors: false,
      keepValues: false,
    });

  const onSubmit = async (raw: FormValues) => {
    // Convert form values to the format expected by the API schema
    const formData = {
      ...raw,
      dueDate: raw.dueDate, // Keep as string for API timezone conversion
      lateCutoff: raw.allowLateSubmissions ? raw.lateCutoff : null,
    };

    const payload = {
      ...formData,
    };

    const res = await fetch(apiPaths.assignments(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      const created = await res.json().catch(() => null);
      onCreate?.(created);
      resetForm(); // clear RHF state before closing (prevents error flash)
      setOpen(false);
    } else {
      const msg = await safeMessage(res);
      console.error('Failed to create assignment:', msg);
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
      <DialogContent className="bg-card max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create Assignment</DialogTitle>
          <DialogDescription>Fill in the assignment details and click Create.</DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmitWrapper} className="space-y-4">
          {/* Title */}
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

          {/* Description (Textarea) */}
          <Controller
            control={control}
            name="description"
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
            control={control}
            name="dueDate"
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
                // Optional: prevent selecting a past time
                min={nowLocalString(timeZone)}
                error={errors.dueDate?.message}
              />
            )}
          />

          <Controller
            control={control}
            name="isGroup"
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

          {/* Publish switch */}
          <Controller
            control={control}
            name="isPublished"
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
            control={control}
            name="allowLateSubmissions"
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
              control={control}
              name="lateCutoff"
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

          <DialogFooter>
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

            <Button type="submit" disabled={!isValid || isSubmitting || courseIsArchived}>
              {isSubmitting ? 'Creating…' : 'Create Assignment'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

async function safeMessage(res: Response) {
  try {
    const data = await res.json();
    return (
      (data as { message?: string; error?: string })?.message ??
      (data as { message?: string; error?: string })?.error ??
      null
    );
  } catch {
    return null;
  }
}
