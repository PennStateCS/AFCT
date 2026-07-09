'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@/components/ui/button';
import InputGroup from '@/components/ui/InputGroup';
import { showToast } from '@/lib/toast';
import { ChangePasswordSchema, type ChangePasswordInput } from '@/schemas/password';
import { PasswordRulesHelper } from '@/components/auth/PasswordRulesHelper';
import { passwordRules } from '@/lib/password-policy';
import { safeSignOut } from '@/lib/safe-signout';
import { apiPaths } from '@/lib/api-paths';

export function ForcedPasswordChangeForm() {
  const router = useRouter();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const {
    control,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<ChangePasswordInput>({
    resolver: zodResolver(ChangePasswordSchema),
    defaultValues: { oldPassword: '', newPassword: '', confirmNewPassword: '' },
    mode: 'onBlur',
    reValidateMode: 'onChange',
  });

  const newPassword = watch('newPassword');
  const confirmPassword = watch('confirmNewPassword');
  const helperId = 'forced-password-helper';
  const passwordRuleStatuses = passwordRules.map((rule) => ({
    label: rule.label,
    passed: rule.test(newPassword),
  }));

  const onSubmit = async (values: ChangePasswordInput) => {
    setSubmitError(null);
    const res = await fetch(apiPaths.myPassword(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldPassword: values.oldPassword, newPassword: values.newPassword }),
    });

    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      const errorMessage = body.error || 'Failed to change password.';
      setSubmitError(errorMessage);
      showToast.error(errorMessage);
      return;
    }

    showToast.success('Password changed successfully.');
    router.push('/dashboard');
    router.refresh();
  };

  return (
    <div className="relative flex min-h-dvh w-full items-start justify-center overflow-x-hidden pt-24 md:pt-[14vh]">
      <div className="fixed inset-0 z-0 bg-gradient-to-br from-[#5F9EA0] via-[#6FAFB2] to-[#2F4A8A]" />
      <div className="fixed inset-0 z-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.15),transparent_70%)]" />

      <div className="relative z-10 mx-4 w-full max-w-[430px]">
        <div className="rounded-2xl bg-white p-8 shadow-[0_25px_60px_rgba(0,0,0,0.25)]">
          <div className="mb-6 text-center">
            <h1 className="text-2xl font-bold text-gray-800">Change Temporary Password</h1>
            <p className="mt-2 text-sm text-gray-600">
              Your account is using a temporary password. You must choose a new password before
              continuing to the dashboard.
            </p>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <Controller
              name="oldPassword"
              control={control}
              render={({ field }) => (
                <InputGroup
                  label="Temporary Password"
                  name="oldPassword"
                  type="password"
                  showEye
                  fieldProps={field}
                  error={errors.oldPassword?.message}
                />
              )}
            />

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
                  isValid={!errors.newPassword && !!newPassword}
                  fieldProps={field}
                  error={errors.newPassword?.message}
                  additionalDescribedBy={helperId}
                />
              )}
            />

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
                  isValid={
                    !errors.confirmNewPassword &&
                    !!confirmPassword &&
                    confirmPassword === newPassword
                  }
                  fieldProps={field}
                  error={errors.confirmNewPassword?.message}
                />
              )}
            />

            <PasswordRulesHelper id={helperId} rules={passwordRuleStatuses} />

            {submitError ? <p className="text-sm text-red-600">{submitError}</p> : null}

            <div className="flex gap-3">
              <Button type="submit" className="flex-1" disabled={isSubmitting}>
                {isSubmitting ? 'Saving...' : 'Change Password'}
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={isSubmitting}
                onClick={() => void safeSignOut({ callbackUrl: '/login' })}
              >
                Sign Out
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
