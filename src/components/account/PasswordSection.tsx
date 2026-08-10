'use client';

import { Button } from '@/components/ui/button';
import InputGroup from '@/components/ui/InputGroup';
import { showToast } from '@/lib/toast';

import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ChangePasswordSchema, type ChangePasswordInput } from '@/schemas/password';

const EMPTY: ChangePasswordInput = {
  oldPassword: '',
  newPassword: '',
  confirmNewPassword: '',
};

/**
 * Changing your own password, on the account page.
 *
 * Was a dialog. It moved here when the account page arrived, and the only real difference is
 * that there is no open/close transition to clear the form on: it clears itself after a
 * successful save instead, so the fields do not sit filled in on a shared machine.
 */
export function PasswordSection({
  onChangePassword,
}: {
  onChangePassword: (oldPassword: string, newPassword: string) => Promise<void>;
}) {
  const {
    control,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<ChangePasswordInput>({
    resolver: zodResolver(ChangePasswordSchema),
    defaultValues: EMPTY,
    mode: 'onBlur',
    reValidateMode: 'onChange',
  });

  const newPw = watch('newPassword');
  const confirmPw = watch('confirmNewPassword');

  const clear = () => reset(EMPTY, { keepDirty: false, keepTouched: false, keepErrors: false });

  const onSubmit = async (values: ChangePasswordInput) => {
    try {
      await onChangePassword(values.oldPassword, values.newPassword);
      showToast.success('Password changed');
      // Nothing here should outlive the save: this is a page, not a dialog that disappears.
      clear();
    } catch (err: unknown) {
      showToast.error(err instanceof Error ? err.message : 'Failed to change password');
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="max-w-md space-y-4">
      {/* Real autocomplete tokens below, not "off": this is the user changing their own
          password, so a password manager should fill the current one and offer to save the new
          one. Blocking that is how people end up locked out (WCAG 2.2 SC 3.3.8). The admin
          reset dialog is the deliberate exception, since there someone is setting another
          user's password. */}
      <Controller
        name="oldPassword"
        control={control}
        render={({ field }) => (
          <InputGroup
            label="Current password"
            name="oldPassword"
            autoComplete="current-password"
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
            label="New password"
            name="newPassword"
            autoComplete="new-password"
            type="password"
            showEye
            showStatus
            isValid={!errors.newPassword && !!newPw}
            fieldProps={field}
            error={errors.newPassword?.message}
            description="Must be at least 8 characters and include an uppercase letter, a lowercase letter, a number, and a special character."
          />
        )}
      />

      <Controller
        name="confirmNewPassword"
        control={control}
        render={({ field }) => (
          <InputGroup
            label="Confirm new password"
            name="confirmNewPassword"
            autoComplete="new-password"
            type="password"
            showEye
            showStatus
            isValid={!errors.confirmNewPassword && !!confirmPw && confirmPw === newPw}
            fieldProps={field}
            error={errors.confirmNewPassword?.message}
          />
        )}
      />

      <div className="flex gap-2">
        <Button type="submit" disabled={isSubmitting || !isDirty}>
          {isSubmitting ? 'Saving...' : 'Change password'}
        </Button>
        <Button type="button" variant="secondary" onClick={clear} disabled={isSubmitting}>
          Clear
        </Button>
      </div>
    </form>
  );
}

export default PasswordSection;
