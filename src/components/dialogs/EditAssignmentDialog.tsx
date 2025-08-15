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
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import InputGroup from '@/components/ui/InputGroup';

import { useEffect, useMemo } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';

import { AssignmentFormSchema, UpdateAssignmentSchema } from '@/schemas';

type EditAssignmentDialogProps = {
  assignment: Assignment;
  open: boolean;
  setOpen: (open: boolean) => void;
  onSave?: (updated: Assignment) => void;
};

// For initializing the datetime-local string
function toDateTimeLocalString(date: Date | string): string {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mi = pad(d.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

// RHF state BEFORE transforms (strings for datetime-local)
type FormValues = z.input<typeof AssignmentFormSchema>;
type ParsedFormValues = z.output<typeof AssignmentFormSchema>;

export function EditAssignmentDialog({
  assignment,
  open,
  setOpen,
  onSave,
}: EditAssignmentDialogProps) {
  const defaultValues: FormValues = useMemo(
    () => ({
      title: assignment.title ?? '',
      description: assignment.description ?? '',
      maxPoints: assignment.maxPoints ?? 0,
      // keep as string for input; schema will transform on submit
      dueDate: toDateTimeLocalString(assignment.dueDate),
      courseId: assignment.courseId,
      // NOTE: AssignmentFormSchema doesn't include isPublished;
      // we keep it separate in the form with a Controller below if you want to edit it here.
    }),
    [assignment],
  );

  const {
    control,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting, isDirty, isValid },
  } = useForm<FormValues>({
    resolver: zodResolver(AssignmentFormSchema),
    defaultValues,
    mode: 'onBlur',
    reValidateMode: 'onChange',
  });

  // Local field for isPublished (since form schema is form-only).
  // If you prefer to keep it *inside* the form schema, you can switch the resolver
  // to UpdateAssignmentSchema and include it; but then you'll also need to include id.
  const isPublished = watch('_isPublished' as any) as boolean | undefined;

  // Reset values when dialog opens; also clear state on close
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

  const onSubmit = async (raw: FormValues) => {
    // Normalize & transform via form schema
    const parsed: ParsedFormValues = AssignmentFormSchema.parse(raw);

    // Compose update payload with id and isPublished flag
    const payload = UpdateAssignmentSchema.parse({
      id: assignment.id,
      ...parsed,
      // if you're editing isPublished here, include it:
      isPublished: typeof isPublished === 'boolean' ? isPublished : assignment.isPublished,
    });

    // Call your API
    const res = await fetch(`/api/assignments/${assignment.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...payload,
        maxPoints: Number(payload.maxPoints),
        dueDate: payload.dueDate.toISOString(),
      }),
    });

    if (!res.ok) {
      const msg = await safeMessage(res);
      throw new Error(msg ?? 'Failed to update assignment');
    }

    const updated = (await res.json()) as Assignment;

    // reset before closing to avoid any flicker
    reset(defaultValues, {
      keepDirty: false,
      keepTouched: false,
      keepErrors: false,
      keepValues: false,
    });
    onSave?.(updated);
    setOpen(false);
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
          <DialogTitle>Edit Assignment</DialogTitle>
          <DialogDescription>
            Update the assignment details and save your changes.
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
          {/* Title */}
          <Controller
            name="title"
            control={control}
            render={({ field }) => (
              <InputGroup
                name="title"
                label="Title"
                fieldProps={field}
                error={errors.title?.message}
              />
            )}
          />

          {/* Description */}
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
                name="dueDate"
                label="Due Date & Time"
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

          {/* Max Points */}
          <Controller
            name="maxPoints"
            control={control}
            render={({ field }) => (
              <InputGroup
                name="maxPoints"
                label="Max Points"
                type="number"
                fieldProps={field}
                min={0}
                step={1}
                error={errors.maxPoints?.message}
              />
            )}
          />

          {/* Publish switch (optional in edit) */}
          <div className="flex items-center justify-between">
            <Label htmlFor="isPublished">Published</Label>
            <Controller
              // Use a faux field key to keep it alongside RHF for convenience
              // (not part of AssignmentFormSchema)
              name={'_isPublished' as any}
              control={control}
              defaultValue={assignment.isPublished}
              render={({ field }) => (
                <Switch
                  id="isPublished"
                  checked={!!field.value}
                  onCheckedChange={(checked) => field.onChange(!!checked)}
                />
              )}
            />
          </div>

          <DialogFooter className="mt-4">
            <DialogClose asChild>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  // Clear touched/dirty/errors before closing to prevent red flash
                  resetForm();
                }}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
            </DialogClose>
            <Button
              type="submit"
              disabled={!isValid || !isDirty || isSubmitting}
              title={
                !isValid
                  ? 'Fix validation errors to save'
                  : !isDirty
                    ? 'No changes to save'
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

async function safeMessage(res: Response) {
  try {
    const data = await res.json();
    return (data as any)?.message ?? (data as any)?.error ?? null;
  } catch {
    return null;
  }
}
