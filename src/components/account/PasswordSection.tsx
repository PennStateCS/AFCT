'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import InputGroup from '@/components/ui/InputGroup';
import { showToast } from '@/lib/toast';

import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ChangePasswordSchema, type ChangePasswordInput } from '@/schemas/password';
import { SetPasswordSchema, type SetPasswordInput } from '@/schemas/password';
import { SettingsSection, SETTINGS_COMPACT } from '@/components/settings/settings-layout';

const EMPTY: ChangePasswordInput = {
  oldPassword: '',
  newPassword: '',
  confirmNewPassword: '',
};

const EMPTY_SET: SetPasswordInput = {
  newPassword: '',
  confirmNewPassword: '',
};

const NEW_PASSWORD_HELP =
  'Must be at least 8 characters and include an uppercase letter, a lowercase letter, a number, and a special character.';

/** What this account can sign in with, and whether it may add a password. */
type Capability = { hasPassword: boolean; canSetPassword: boolean };

/**
 * Setting or changing your own password, on the account page.
 *
 * Two forms rather than one, because they are two different acts. Changing a password proves
 * you know the current one. Setting a first password cannot: an account created by an
 * institutional sign-in or an LMS launch has never had one, and on a site with no mail server
 * there is no reset link either, so being signed in is the only proof there is.
 *
 * Which form to show is answered by the server (`/api/me/identities` returns `canSetPassword`),
 * never worked out here, so this page cannot offer something the endpoint would refuse.
 */
export function PasswordSection({
  onChangePassword,
}: {
  onChangePassword: (oldPassword: string | null, newPassword: string) => Promise<void>;
}) {
  /**
   * Null while unknown. The forms wait for it rather than guessing: defaulting to the change
   * form would flash a "Current password" field at somebody who has no current password, and
   * defaulting to the set form would offer a first password to somebody who already has one.
   */
  const [capability, setCapability] = useState<Capability | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/me/identities');
      if (!res.ok) throw new Error('could not read the account');
      const data = (await res.json()) as Capability;
      setCapability(data);
      setLoadFailed(false);
    } catch {
      // The page is still useful: an account that has a password is the common case, and the
      // endpoint refuses anything this is wrong about. Say so rather than showing nothing.
      setCapability({ hasPassword: true, canSetPassword: false });
      setLoadFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // The panel is drawn whatever the answer turns out to be, so the tab does not start as
  // bare text on the page background and then grow a card once the server replies.
  return (
    <SettingsSection title="Password" className={SETTINGS_COMPACT}>
      {!capability ? (
        // `role="status"` rather than a bare `aria-live`: this element is created together with
        // its text and then replaced by the form, so it is announced on arrival at best. The
        // region below, inside the loaded tree, is the one that carries anything afterwards.
        <p className="text-muted-foreground text-sm" role="status" aria-live="polite">
          Loading…
        </p>
      ) : (
        <>
          {loadFailed && (
            <p className="text-muted-foreground text-sm" role="status">
              AFCT could not check how this account signs in, so it is showing the usual form.
              Reload the page if it does not work.
            </p>
          )}
          {capability.hasPassword ? (
            <ChangeForm onChangePassword={onChangePassword} />
          ) : capability.canSetPassword ? (
            <SetForm onChangePassword={onChangePassword} onDone={load} />
          ) : (
            <NoPasswordAllowed />
          )}
        </>
      )}
    </SettingsSection>
  );
}

/** The account signs in elsewhere and this site does not allow AFCT passwords on top. */
function NoPasswordAllowed() {
  return (
    <div className="space-y-2 text-sm">
      <p>
        You sign in to AFCT through your institution or your LMS, so there is no AFCT password on
        this account.
      </p>
      <p className="text-muted-foreground">
        This site does not allow AFCT passwords on accounts that sign in that way. An administrator
        can give you one if you need it, for example to use the desktop client.
      </p>
    </div>
  );
}

/** Setting a first password. No current-password field, because there is no current password. */
function SetForm({
  onChangePassword,
  onDone,
}: {
  onChangePassword: (oldPassword: string | null, newPassword: string) => Promise<void>;
  onDone: () => Promise<void>;
}) {
  const {
    control,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<SetPasswordInput>({
    resolver: zodResolver(SetPasswordSchema),
    defaultValues: EMPTY_SET,
    mode: 'onBlur',
    reValidateMode: 'onChange',
  });

  const newPw = watch('newPassword');
  const confirmPw = watch('confirmNewPassword');

  const onSubmit = async (values: SetPasswordInput) => {
    try {
      await onChangePassword(null, values.newPassword);
      showToast.success('Password set');
      reset(EMPTY_SET, { keepDirty: false, keepTouched: false, keepErrors: false });
      // Ask the server again rather than assuming: this account now has a password, so the
      // change form is the right one from here on.
      await onDone();
    } catch (err: unknown) {
      showToast.error(err instanceof Error ? err.message : 'Failed to set your password');
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="space-y-2 text-sm">
        <p>
          You sign in to AFCT through your institution or your LMS, and this account has no AFCT
          password. You can set one here.
        </p>
        <p className="text-muted-foreground">
          You can carry on signing in the way you do now; this only adds another way. The AFCT
          desktop client asks for an email and a password, so you need one to use it.
        </p>
      </div>

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
            description={NEW_PASSWORD_HELP}
            // The rules are what you need in order to fix the error, so they stay put
            // instead of being replaced by it.
            showDescriptionWithError
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

      <div className="flex justify-end pt-2">
        <Button type="submit" disabled={isSubmitting || !isDirty}>
          {isSubmitting ? 'Saving...' : 'Set password'}
        </Button>
      </div>
    </form>
  );
}

/**
 * Changing a password you already have.
 *
 * Was a dialog. It moved here when the account page arrived, and the only real difference is
 * that there is no open/close transition to clear the form on: it clears itself after a
 * successful save instead, so the fields do not sit filled in on a shared machine.
 */
function ChangeForm({
  onChangePassword,
}: {
  onChangePassword: (oldPassword: string | null, newPassword: string) => Promise<void>;
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
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
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
            description={NEW_PASSWORD_HELP}
            // The rules are what you need in order to fix the error, so they stay put
            // instead of being replaced by it.
            showDescriptionWithError
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

      {/* Secondary first, primary last, at the right edge: the same row the Profile and
          Profile photo tabs end with, so the Save is always in the same place. */}
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="secondary" onClick={clear} disabled={isSubmitting}>
          Clear
        </Button>
        <Button type="submit" disabled={isSubmitting || !isDirty}>
          {isSubmitting ? 'Saving...' : 'Change password'}
        </Button>
      </div>
    </form>
  );
}

export default PasswordSection;
