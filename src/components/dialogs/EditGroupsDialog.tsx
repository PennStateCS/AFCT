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
import { UpdateGroupSchema, type UpdateGroupInput } from '@/schemas/group';
import { toast } from 'sonner';
import { apiPaths } from '@/lib/api-paths';

type EditGroupDialogProps = {
  open: boolean;
  setOpen: (open: boolean) => void;
  group?: { id: string; name: string } | null;
  courseId: string;
  onSuccess?: () => void;
};

export function EditGroupDialog({
  open,
  setOpen,
  group,
  courseId,
  onSuccess,
}: EditGroupDialogProps) {
  const defaults: UpdateGroupInput = { name: group?.name ?? '' };

  const {
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting, isValid },
  } = useForm<UpdateGroupInput>({
    resolver: zodResolver(UpdateGroupSchema),
    defaultValues: defaults,
  });

  useEffect(() => {
    if (open) reset({ name: group?.name ?? '' });
  }, [open, group, reset]);

  const onSubmit = async (raw: UpdateGroupInput) => {
    if (!group) return;
    try {
      const res = await fetch(apiPaths.courseGroup(courseId, group.id), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(raw),
      });

      if (res.ok) {
        onSuccess?.();
        setOpen(false);
        toast.success(`Updated group: ${raw.name}`);
      } else {
        const body = await res.json().catch(() => ({ error: 'Unexpected Error' }));
        toast.error(body.error || 'Failed to update group');
      }
    } catch (err) {
      console.error(err);
      toast.error('Failed to update group');
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(val) => {
        setOpen(val);
        if (!val) reset(defaults);
      }}
    >
      <DialogContent className="bg-card max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit Group</DialogTitle>
          <DialogDescription>Update group name.</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <Controller
            control={control}
            name="name"
            render={({ field }) => (
              <InputGroup
                label="Group Name"
                name="name"
                fieldProps={field}
                error={errors.name?.message}
              />
            )}
          />

          <DialogFooter className="bg-card mt-4">
            <DialogClose asChild>
              <Button
                variant="secondary"
                type="button"
                onClick={() => reset(defaults)} // clear touched/dirty/errors before closing
                disabled={isSubmitting}
              >
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={!isValid || isSubmitting}>
              {isSubmitting ? 'Saving…' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
