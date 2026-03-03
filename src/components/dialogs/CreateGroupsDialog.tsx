'use client';

import { useEffect } from 'react';
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
import InputGroup from '@/components/ui/InputGroup';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { CreateGroupSchema, type CreateGroupRaw } from '@/schemas/group';
import { toast } from 'sonner';

type CreateGroupDialogProps = {
  open: boolean;
  setOpen: (open: boolean) => void;
  courseId?: string; // optional preset
  onSuccess?: () => void;
};

export function CreateGroupDialog({ open, setOpen, courseId, onSuccess }: CreateGroupDialogProps) {
  const defaults: CreateGroupRaw = { name: '', courseId: courseId ?? '' };

  const { control, handleSubmit, reset, setError, formState: { errors, isSubmitting, isValid } } = useForm<CreateGroupRaw>({
    resolver: zodResolver(CreateGroupSchema),
    defaultValues: defaults,
  });

  useEffect(() => {
    if (open) reset(defaults);
  }, [open, reset]);

  const onSubmit = async (raw: CreateGroupRaw) => {
    try {
      const payload = { ...raw, courseId: courseId ?? raw.courseId };
      const res = await fetch(`/api/courses/${payload.courseId}/groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: payload.name }),
      });

      if (res.ok) {
        onSuccess?.();
        toast.success(`Group "${payload.name}" created!`);
        reset(defaults);
        setOpen(false);
      } else {
        const body = await res.json().catch(() => ({ error: 'Unexpected Error' }));

        // If the server returned field-level validation details, apply them to the form
        if (body?.details && typeof body.details === 'object') {
          Object.entries(body.details).forEach(([field, msgs]) => {
            const msg = Array.isArray(msgs) ? msgs.join(', ') : String(msgs);
            setError(field as any, { type: 'server', message: msg });
          });
          toast.error(body.error || 'Invalid input');
        } else {
          toast.error(body.error || 'Failed to create group');
        }
      }
    } catch (err) {
      console.error(err);
      toast.error('Failed to create group');
    }
  };

  return (
    <Dialog open={open} onOpenChange={(val) => { setOpen(val); if (!val) reset(defaults); }}>
      <DialogContent className="bg-card max-w-lg">
        <DialogHeader>
          <DialogTitle>Create Group</DialogTitle>
          <DialogDescription>Create a group and assign to a course.</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <Controller control={control} name="name" render={({ field }) => (
            <InputGroup label="Group Name" name="name" fieldProps={field} error={errors.name?.message} />
          )} />

          {/* If no courseId preset, show a course select (rare for this flow) */}
          {!courseId && (
            <Controller control={control} name="courseId" render={({ field }) => (
              <InputGroup label="Course ID" name="courseId" fieldProps={field} error={errors.courseId?.message} />
            )} />
          )}

          <DialogFooter className="bg-card mt-4">
            <DialogClose asChild>
              <Button variant="secondary" type="button" disabled={isSubmitting}>Cancel</Button>
            </DialogClose>
            <Button type="submit" disabled={!isValid || isSubmitting}>{isSubmitting ? 'Creating...' : 'Create Group'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
