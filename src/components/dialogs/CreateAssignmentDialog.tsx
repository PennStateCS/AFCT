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
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import InputGroup from '@/components/ui/InputGroup';

import { useEffect, useMemo } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import { useCourseData } from '@/hooks/use-course';

// ✅ Import assignment schemas directly to avoid barrel/cycle issues
import { CreateAssignmentFormSchema, CreateAssignmentSchema } from '@/schemas/assignment';

type FormValues = z.infer<typeof CreateAssignmentFormSchema>; // strings for datetime-local
type ParsedValues = z.output<typeof CreateAssignmentSchema>; // Dates, coerced numbers

import { Assignment } from '@prisma/client';

type CreateAssignmentDialogProps = {
  open: boolean;
  setOpen: (open: boolean) => void;
  courseId: string;
  onCreate?: (assignment: Assignment) => void;
};

function nowLocalString(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}`;
}

// Default to “today at 23:59”
function defaultDueLocalString(): string {
  const d = new Date();
  d.setHours(23, 59, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}`;
}

export function CreateAssignmentDialog({
  open,
  setOpen,
  courseId,
  onCreate,
}: CreateAssignmentDialogProps) {
  // Call hook
  const { course } = useCourseData(courseId);
  const effectiveCourseId = course?.id ?? courseId;

  // Form defaults (strings for datetime-local fields)
  const defaults: FormValues = useMemo(
    () => ({
      title: '',
      description: '',
      maxPoints: '100',
      dueDate: defaultDueLocalString(),
      isPublished: false,
      courseId: effectiveCourseId,
    }),
    [effectiveCourseId],
  );

  const {
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting, isValid },
  } = useForm<FormValues>({
    resolver: zodResolver(CreateAssignmentFormSchema),
    defaultValues: defaults,
    mode: 'onBlur',
    reValidateMode: 'onChange',
  });

  // Refresh defaults on open; also clear state on close to avoid flicker
  useEffect(() => {
    if (open) {
      reset(
        { ...defaults, dueDate: defaultDueLocalString() },
        { keepDirty: false, keepTouched: false, keepErrors: false, keepValues: false },
      );
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
      maxPoints: Number(raw.maxPoints), // Convert string to number for API schema
      dueDate: raw.dueDate, // Keep as string for CreateAssignmentSchema to transform
    };

    // Normalize & transform via Zod
    const values: ParsedValues = CreateAssignmentSchema.parse(formData);

    const payload = {
      ...values,
      maxPoints: Number(values.maxPoints),
      dueDate: values.dueDate.toISOString(),
    };

    const res = await fetch('/api/assignments', {
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
                min={nowLocalString()}
                error={errors.dueDate?.message}
              />
            )}
          />

          {/* Max Points */}
          <Controller
            control={control}
            name="maxPoints"
            render={({ field }) => (
              <InputGroup
                label="Max Points"
                name="maxPoints"
                type="number"
                fieldProps={field}
                min={0}
                step={1}
                error={errors.maxPoints?.message}
              />
            )}
          />

          {/* Publish switch */}
          <div className="flex items-center justify-between">
            <Label htmlFor="isPublished">Publish Now</Label>
            <Controller
              control={control}
              name="isPublished"
              render={({ field }) => (
                <Switch
                  id="isPublished"
                  checked={!!field.value}
                  onCheckedChange={(checked) => field.onChange(!!checked)}
                />
              )}
            />
          </div>

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

            <Button type="submit" disabled={!isValid || isSubmitting || !!course?.isArchived}>
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
