'use client';

import { useEffect, useMemo } from 'react';
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
import { toast } from 'sonner';
import InputGroup from '@/components/ui/InputGroup';
import SelectField from '@/components/ui/SelectField';
import { useEffectiveTimezone } from '@/hooks/use-effective-timezone';

import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

import { CreateUserSchema, type CreateUserRaw, type CreateUserInput } from '@/schemas/user';
import { roleOptions, formatRole } from '@/lib/roles';

// For the checklist UI only
const passwordRules = [
  { label: 'At least 8 characters', test: (pw: string) => pw.length >= 8 },
  { label: 'One uppercase letter', test: (pw: string) => /[A-Z]/.test(pw) },
  { label: 'One lowercase letter', test: (pw: string) => /[a-z]/.test(pw) },
  { label: 'One number', test: (pw: string) => /\d/.test(pw) },
  { label: 'One special character', test: (pw: string) => /[^A-Za-z0-9]/.test(pw) },
];

type CreateUserDialogProps = {
  open: boolean;
  setOpen: (open: boolean) => void;
  onSuccess?: () => void;
};

export function CreateUserDialog({ open, setOpen, onSuccess }: CreateUserDialogProps) {
  const { timezone } = useEffectiveTimezone();
  const defaults: CreateUserRaw = useMemo(() => {
    const defaultRole = roleOptions.includes('STUDENT' as any)
      ? 'STUDENT'
      : (roleOptions[0] ?? 'STUDENT');
    return {
      firstName: '',
      lastName: '',
      email: '',
      password: '',
      confirmPassword: '',
      role: defaultRole as 'ADMIN' | 'FACULTY' | 'TA' | 'STUDENT',
      timezone,
    };
  }, [roleOptions, timezone]);

  const {
    control,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting, isValid },
  } = useForm<CreateUserRaw>({
    resolver: zodResolver(CreateUserSchema),
    defaultValues: defaults,
    mode: 'onBlur',
    reValidateMode: 'onChange',
  });

  // Clear RHF state when closing (prevents red error flash)
  useEffect(() => {
    if (open) {
      reset(defaults, {
        keepDirty: false,
        keepTouched: false,
        keepErrors: false,
        keepValues: true,
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
    reset(defaults, { keepDirty: false, keepTouched: false, keepErrors: false, keepValues: false });

  const onSubmit = async (raw: CreateUserRaw) => {
    const parsed: CreateUserInput = CreateUserSchema.parse(raw);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { confirmPassword, ...payload } = parsed;

    const res = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      onSuccess?.();
      resetForm();
      setOpen(false);
    } else {
      const text = JSON.parse(await res.text().catch(() => '{"error":"Unexpected Error"}'));
      console.error('Failed to create user:', text);
      toast.error(text.error);
    }
  };

  const pw = watch('password');

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
          <DialogTitle>Create New User</DialogTitle>
          <DialogDescription>Fill out the fields to create a user account.</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {/* First Name */}
          <Controller
            control={control}
            name="firstName"
            render={({ field }) => (
              <InputGroup
                label="First Name"
                name="firstName"
                fieldProps={field}
                error={errors.firstName?.message}
              />
            )}
          />

          {/* Last Name */}
          <Controller
            control={control}
            name="lastName"
            render={({ field }) => (
              <InputGroup
                label="Last Name"
                name="lastName"
                fieldProps={field}
                error={errors.lastName?.message}
              />
            )}
          />

          {/* Email */}
          <Controller
            control={control}
            name="email"
            render={({ field }) => (
              <InputGroup
                label="Email"
                name="email"
                type="email"
                fieldProps={field}
                error={errors.email?.message}
                showStatus
                isValid={!errors.email && !!field.value}
              />
            )}
          />

          {/* Password */}
          <Controller
            control={control}
            name="password"
            render={({ field }) => (
              <InputGroup
                label="Password"
                name="password"
                type="password"
                showEye
                fieldProps={field}
                error={errors.password?.message}
                showStatus
                isValid={!errors.password && !!field.value}
              />
            )}
          />

          {/* Confirm Password */}
          <Controller
            control={control}
            name="confirmPassword"
            render={({ field }) => (
              <InputGroup
                label="Confirm Password"
                name="confirmPassword"
                type="password"
                showEye
                fieldProps={field}
                error={errors.confirmPassword?.message}
                showStatus
                isValid={!errors.confirmPassword && !!field.value && field.value === pw}
              />
            )}
          />

          {/* Role */}
          <Controller
            control={control}
            name="role"
            render={({ field }) => (
              <SelectField
                label="Default Role"
                name="role"
                value={field.value ?? ''}
                onValueChange={(v) => field.onChange(v)}
                placeholder="Select a role"
                options={roleOptions.map((r) => ({ value: r, label: formatRole(r) }))}
                error={errors.role?.message}
              />
            )}
          />

          {/* Password checklist (UI helper) */}
          <div className="text-muted-foreground pt-1 text-xs">
            <div className="text-xs">Password must include:</div>
            <ul className="ml-4 list-disc">
              {passwordRules.map((rule) => {
                const ok = rule.test(pw ?? '');
                return (
                  <li
                    key={rule.label}
                    className={ok ? 'text-xs text-green-600' : 'text-xs text-red-500'}
                  >
                    {rule.label}
                  </li>
                );
              })}
            </ul>
          </div>

          <DialogFooter className="bg-card mt-4">
            <DialogClose asChild>
              <Button
                variant="secondary"
                type="button"
                onClick={resetForm} // clear touched/dirty/errors before closing
                disabled={isSubmitting}
              >
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={!isValid || isSubmitting}>
              {isSubmitting ? 'Creating...' : 'Create User'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
