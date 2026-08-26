'use client';

import { useEffect, useMemo, useState } from 'react';
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
import { showToast } from '@/lib/toast';
import InputGroup from '@/components/ui/InputGroup';
import { useEffectiveTimezone } from '@/hooks/use-effective-timezone';
import { formatDateTimeInTimeZone } from '@/lib/date-format';

import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

import { CreateUserSchema, type CreateUserRaw, type CreateUserInput } from '@/schemas/user';
import { apiPaths } from '@/lib/api-paths';
import type { OrphanedLaunchAccount } from '@/lib/lti/jit-duplicates';

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
  const { timezone, hour12 } = useEffectiveTimezone();
  const defaults: CreateUserRaw = useMemo(() => {
    return {
      firstName: '',
      lastName: '',
      email: '',
      password: '',
      confirmPassword: '',
      timezone,
    };
  }, [timezone]);

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

    const res = await fetch(apiPaths.admin.users(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Only when the box is ticked AND the account it was ticked for is still the one on
      // screen: a name edited afterwards finds a different account, or none.
      body: JSON.stringify(
        adopt && launchAccount
          ? { ...payload, adoptLaunchAccountId: launchAccount.userId }
          : payload,
      ),
    });

    if (res.ok) {
      onSuccess?.();
      resetForm();
      setOpen(false);
    } else {
      const text = JSON.parse(await res.text().catch(() => '{"error":"Unexpected Error"}'));
      console.error('Failed to create user:', text);
      showToast.error(text.error);
    }
  };

  const pw = watch('password');

  /**
   * Look for an account an LMS already made for this name.
   *
   * Debounced, because it runs while somebody is typing a name and most keystrokes are halfway
   * through one. A miss is silent: the answer is usually none, and saying so would be noise.
   */
  const firstName = watch('firstName');
  const lastName = watch('lastName');
  const [launchAccount, setLaunchAccount] = useState<OrphanedLaunchAccount | null>(null);
  const [adopt, setAdopt] = useState(false);

  useEffect(() => {
    const first = firstName?.trim() ?? '';
    const last = lastName?.trim() ?? '';
    if (!open || !first || !last) {
      setLaunchAccount(null);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(() => {
      void fetch(apiPaths.admin.launchAccount(first, last))
        .then((res) => (res.ok ? res.json() : { account: null }))
        .then((body: { account: OrphanedLaunchAccount | null }) => {
          if (cancelled) return;
          setLaunchAccount(body.account);
          // A different account (or none) is a different decision, so the tick does not carry
          // over: it would otherwise adopt whatever the last lookup happened to return.
          if (!body.account) setAdopt(false);
        })
        .catch(() => {
          // A failed lookup is not worth interrupting an administrator over: the warning is a
          // courtesy, and creating the account still works without it.
          if (!cancelled) setLaunchAccount(null);
        });
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, firstName, lastName]);

  return (
    <Dialog
      open={open}
      onOpenChange={(val) => {
        setOpen(val);
        if (!val) resetForm();
      }}
    >
      <DialogContent className="max-w-2xl">
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
                requiredMark
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
                requiredMark
                name="lastName"
                fieldProps={field}
                error={errors.lastName?.message}
              />
            )}
          />

          {/*
            An account an LMS already made for this person.
            Shown rather than acted on: two people can share a name, so this says what it found
            and leaves the decision, with the box off until somebody ticks it.
          */}
          <div role="status" aria-live="polite">
            {launchAccount ? (
              <div className="border-status-info-border bg-status-info-bg space-y-2 rounded-md border p-3 text-sm">
                <p className="font-medium">Someone with this name already signed in from an LMS</p>
                <p className="text-muted-foreground">
                  {launchAccount.email}, connected{' '}
                  {formatDateTimeInTimeZone(launchAccount.connectedAt, timezone, hour12)}, and never
                  added to a course. If that is the same person, move their LMS sign-in to the
                  account you are creating, or they will keep landing on the empty one.
                </p>
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={adopt}
                    onChange={(e) => setAdopt(e.target.checked)}
                  />
                  <span>
                    Move their LMS sign-in to this account, and retire{' '}
                    <span className="font-medium">{launchAccount.email}</span>
                  </span>
                </label>
              </div>
            ) : null}
          </div>

          {/* Email */}
          <Controller
            control={control}
            name="email"
            render={({ field }) => (
              <InputGroup
                label="Email"
                requiredMark
                name="email"
                type="email"
                // Somebody else's address. Left unmarked, the browser offers the admin's
                // own, which is how you create an account against the wrong person.
                autoComplete="off"
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
                requiredMark
                name="password"
                type="password"
                // new-password, not off: this tells the manager the field SETS a password
                // rather than asks for one, so it neither autofills the admin's own
                // credential here nor offers to save this one as theirs.
                autoComplete="new-password"
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
                requiredMark
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                showEye
                fieldProps={field}
                error={errors.confirmPassword?.message}
                showStatus
                isValid={!errors.confirmPassword && !!field.value && field.value === pw}
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
                    className={ok ? 'text-status-success text-xs' : 'text-destructive text-xs'}
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
