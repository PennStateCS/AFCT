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
import { toast } from 'sonner';

import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ChangePasswordSchema, type ChangePasswordInput } from '@/schemas/password';

type Props = {
  open: boolean;
  setOpen: (open: boolean) => void;
  onChangePassword: (oldPassword: string, newPassword: string) => Promise<void>;
};

export function ChangePasswordDialog({ open, setOpen, onChangePassword }: Props) {
  const {
    control,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<ChangePasswordInput>({
    resolver: zodResolver(ChangePasswordSchema),
    defaultValues: { oldPassword: '', newPassword: '', confirmNewPassword: '' },
    mode: 'onBlur',
    reValidateMode: 'onChange',
  });

  const newPw = watch('newPassword');
  const confirmPw = watch('confirmNewPassword');

  // Clear the form UI state when dialog closes (prevents red flash on cancel)
  useEffect(() => {
    if (!open) {
      reset(
        { oldPassword: '', newPassword: '', confirmNewPassword: '' },
        { keepDirty: false, keepTouched: false, keepErrors: false },
      );
    }
  }, [open, reset]);

  const onSubmit = async (values: ChangePasswordInput) => {
    try {
      await onChangePassword(values.oldPassword, values.newPassword);
      toast.success('Password changed successfully!');
      setOpen(false);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to change password';
      toast.error(errorMessage);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(val) => {
        if (!val) {
          reset(
            { oldPassword: '', newPassword: '', confirmNewPassword: '' },
            { keepDirty: false, keepTouched: false, keepErrors: false },
          );
        }
        setOpen(val);
      }}
    >
      <DialogContent className="bg-card">
        <DialogHeader>
          <DialogTitle>Change Password</DialogTitle>
          <DialogDescription>Enter your old password and choose a new one.</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {/* Old Password */}
          <Controller
            name="oldPassword"
            control={control}
            render={({ field }) => (
              <InputGroup
                label="Old Password"
                name="oldPassword"
                type="password"
                showEye
                fieldProps={field}
                error={errors.oldPassword?.message}
              />
            )}
          />

          {/* New Password */}
          <Controller
            name="newPassword"
            control={control}
            render={({ field }) => (
              <InputGroup
                label="New Password"
                name="newPassword"
                type="password"
                showEye
                showStatus
                isValid={!errors.newPassword && !!newPw}
                fieldProps={field}
                error={errors.newPassword?.message}
                description="At least 8 characters and include upper, lower, and a number."
              />
            )}
          />

          {/* Confirm New Password */}
          <Controller
            name="confirmNewPassword"
            control={control}
            render={({ field }) => (
              <InputGroup
                label="Confirm New Password"
                name="confirmNewPassword"
                type="password"
                showEye
                showStatus
                isValid={!errors.confirmNewPassword && !!confirmPw && confirmPw === newPw}
                fieldProps={field}
                error={errors.confirmNewPassword?.message}
              />
            )}
          />

          <DialogFooter className="mt-2">
            <DialogClose asChild>
              <Button
                variant="secondary"
                type="button"
                onClick={() =>
                  reset(
                    { oldPassword: '', newPassword: '', confirmNewPassword: '' },
                    { keepDirty: false, keepTouched: false, keepErrors: false },
                  )
                }
                disabled={isSubmitting}
              >
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={isSubmitting || !isDirty}>
              {isSubmitting ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
