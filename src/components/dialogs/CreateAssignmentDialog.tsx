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
import { toast } from 'sonner';

import { useEffect, useMemo } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import { CreateAssignmentSchema } from '@/schemas';

type FormValues = z.input<typeof CreateAssignmentSchema>; // RHF state (strings for datetime-local)
type ParsedValues = z.output<typeof CreateAssignmentSchema>; // parsed by Zod (Date, numbers)

type CreateAssignmentDialogProps = {
  open: boolean;
  setOpen: (open: boolean) => void;
  courseId: string;
  onCreate?: (assignment: any) => void;
};

function defaultDueLocalString(): string {
  const now = new Date();
  // today at 23:59 local
  now.setHours(23, 59, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(
    now.getMinutes(),
  )}`;
}

export function CreateAssignmentDialog({
  open,
  setOpen,
  courseId,
  onCreate,
}: CreateAssignmentDialogProps) {
  const defaults: FormValues = useMemo(
    () => ({
      title: '',
      description: '',
      maxPoints: 100,
      dueDate: defaultDueLocalString(),
      courseId,
      isPublished: false,
    }),
    [courseId],
  );

  const {
    control,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(CreateAssignmentSchema),
    defaultValues: defaults,
    mode: 'onBlur',
    reValidateMode: 'onChange',
  });

  // Reset when closed from outside, and refresh defaults when opened
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

  const onSubmit = async (raw: FormValues) => {
    const values: ParsedValues = CreateAssignmentSchema.parse(raw); // normalize/transform

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
      toast.success('Assignment created successfully');
      onCreate?.(created);
      // reset before close to avoid any error flash
      reset(defaults, {
        keepDirty: false,
        keepTouched: false,
        keepErrors: false,
        keepValues: false,
      });
      setOpen(false);
    } else {
      const msg = await safeMessage(res);
      toast.error(msg ?? 'Failed to create assignment');
    }
  };

  const resetForm = () =>
    reset(defaults, {
      keepDirty: false,
      keepTouched: false,
      keepErrors: false,
      keepValues: false,
    });

  // Watch fields if you want live constraints (e.g., min dueDate) — here just example:
  const dueStr = watch('dueDate');

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

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
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
                // optional: prevent setting a past due
                min={defaultDueLocalString().slice(0, 16)}
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
                onClick={() => {
                  // clear touched/dirty/errors before closing
                  resetForm();
                }}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
            </DialogClose>

            <Button type="submit" disabled={isSubmitting}>
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
    return (data as any)?.message ?? (data as any)?.error ?? null;
  } catch {
    return null;
  }
}
