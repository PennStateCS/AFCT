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

import { useEffect, useMemo, useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';

import {
  AssignmentFormSchema, // form-only schema (title, description, maxPoints, dueDate, courseId)
  UpdateAssignmentSchema, // partial + id + publish rule
} from '@/schemas/assignment';

// Convert Date → "YYYY-MM-DDTHH:MM" for <input type="datetime-local">
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

type EditAssignmentDialogProps = {
  assignment: Assignment;
  open: boolean;
  setOpen: (open: boolean) => void;
  onSave?: (updated: Assignment) => void;
};

// RHF state BEFORE Zod transforms (string for datetime-local, etc.)
type FormValues = z.infer<typeof AssignmentFormSchema>;

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
      maxPoints: String(assignment.maxPoints ?? 100),
      dueDate: toDateTimeLocalString(assignment.dueDate), // string for input
      courseId: assignment.courseId,
    }),
    [assignment],
  );

  const {
    control,
    handleSubmit,
    reset,
    formState: { errors, isDirty, isValid, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(AssignmentFormSchema),
    defaultValues,
    mode: 'onBlur',
    reValidateMode: 'onChange',
  });

  // Keep publish state separate since it's not part of form schema
  const [isPublished, setIsPublished] = useState(assignment.isPublished);

  // Reset on open/close (prevents error/touched flicker)
  useEffect(() => {
    if (open) {
      reset(defaultValues, {
        keepDirty: false,
        keepTouched: false,
        keepErrors: false,
        keepValues: true,
      });
      setIsPublished(assignment.isPublished);
    } else {
      reset(defaultValues, {
        keepDirty: false,
        keepTouched: false,
        keepErrors: false,
        keepValues: false,
      });
      setIsPublished(assignment.isPublished);
    }
  }, [open, defaultValues, reset, assignment.isPublished]);

  const resetForm = () => {
    reset(defaultValues, {
      keepDirty: false,
      keepTouched: false,
      keepErrors: false,
      keepValues: false,
    });
    setIsPublished(assignment.isPublished);
  };

  const onSubmit = async (raw: FormValues) => {
    // Convert form values to the format expected by the API
    const formData = {
      ...raw,
      maxPoints: Number(raw.maxPoints), // Convert string to number
    };
    
    // Use the update schema with transformations for API
    const payload = UpdateAssignmentSchema.parse({
      id: assignment.id,
      ...formData,
      isPublished: typeof isPublished === 'boolean' ? isPublished : assignment.isPublished,
    });

    const res = await fetch(`/api/assignments/${assignment.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...payload,
        maxPoints: Number(payload.maxPoints),
        dueDate: payload.dueDate?.toISOString(),
      }),
    });
    if (!res.ok) {
      const msg = await safeMessage(res);
      throw new Error(msg ?? 'Failed to update assignment');
    }

    const updated = (await res.json()) as Assignment;
    // reset before closing to avoid any flash
    resetForm();
    onSave?.(updated);
    setOpen(false);
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

          {/* Max Points */}
          <Controller
            name="maxPoints"
            control={control}
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

          {/* Published switch (kept outside the form schema) */}
          <div className="flex items-center justify-between">
            <Label htmlFor="isPublished">Published</Label>
            <Switch
              id="isPublished"
              checked={isPublished}
              onCheckedChange={setIsPublished}
            />
          </div>

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
    return (data as { message?: string; error?: string })?.message ?? 
           (data as { message?: string; error?: string })?.error ?? null;
  } catch {
    return null;
  }
}
