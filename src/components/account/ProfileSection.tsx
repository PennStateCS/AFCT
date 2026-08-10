'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { AvatarCrop, type AvatarCropRef } from '@/components/AvatarCrop';
import { Trash2, Upload } from 'lucide-react';
import { showToast } from '@/lib/toast';

import InputGroup from '@/components/ui/InputGroup';
import SelectField from '@/components/ui/SelectField';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';

import type { SessionUser } from '@/types/next-auth';
import {
  UpdateProfileSchema,
  type UpdateProfileRaw,
  type UpdateProfileInput,
} from '@/schemas/profile';
import { COMMON_TIMEZONES, formatTimezoneLabel } from '@/lib/timezones';
import { apiPaths } from '@/lib/api-paths';

// Sentinel for the "follow my device/system" choice. Radix Select forbids an
// empty-string item value, so we use a token and translate it to '' on submit;
// the server stores that as null, which makes the display-timezone resolver fall
// through to the system default, then the browser.
const AUTO_TIMEZONE = '__auto__';

type ProfileUser = SessionUser & {
  cropX?: number;
  cropY?: number;
  zoom?: number;
};

type ProfileSectionProps = {
  user: ProfileUser;
  onSave?: (updatedUser: Partial<ProfileUser>) => Promise<void>;
};

/**
 * Your name, timezone and avatar, on the account page.
 *
 * Moved here from a dialog. The avatar cropping and the seeding rule came with it unchanged in
 * substance; see the comment on the seeding effect for the one thing that had to be rethought.
 */
export function ProfileSection({ user, onSave }: ProfileSectionProps) {
  // Local preview state (keep separate from RHF file)
  const queryClient = useQueryClient();
  // The navbar/sidebar avatars read from the NextAuth session; update() re-runs the
  // session callback (which re-reads the user from the DB), so the new photo/crop
  // appears immediately without a page reload.
  const { update: updateSession } = useSession();
  const avatarEditorRef = useRef<AvatarCropRef['current']>(null);
  // Ref (not getElementById) to trigger the hidden file input, and a unique id so the
  // input/button/error can be associated even if the dialog renders more than once.
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const avatarUploadId = useId();
  const avatarErrorId = `${avatarUploadId}-error`;
  const [avatarPreview, setAvatarPreview] = useState<string>(
    user.avatar ? apiPaths.files.pfp(user.avatar) : '',
  );
  const [avatarCrop, setAvatarCrop] = useState({
    cropX: user.cropX ?? 0.5,
    cropY: user.cropY ?? 0.5,
    zoom: user.zoom ?? 1,
  });
  // What "Automatic" would resolve to on this device, shown for reassurance.
  const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

  // RHF defaults – email is read-only so it isn't in the schema
  const defaults: UpdateProfileRaw = useMemo(
    () => ({
      firstName: user.firstName ?? '',
      lastName: user.lastName ?? '',
      timezone: user.timezone ?? '',
      avatarFile: undefined,
      cropX: user.cropX ?? 0.5,
      cropY: user.cropY ?? 0.5,
      zoom: user.zoom ?? 1,
      deleteAvatar: false,
    }),
    [user],
  );

  // RHF with Zod
  const {
    control,
    handleSubmit,
    reset,
    setValue,
    formState: { errors, isSubmitting, isValid },
  } = useForm<UpdateProfileRaw, unknown, UpdateProfileInput>({
    resolver: zodResolver(UpdateProfileSchema),
    defaultValues: defaults,
    mode: 'onChange',
    reValidateMode: 'onChange',
  });

  // Seed once, on mount. The dialog this replaced seeded on an open/close transition for a
  // specific reason: the parent rebuilds the `user` object on every render, so re-seeding on
  // any re-render let a background refetch or session update clobber an in-progress avatar
  // position or zoom (the "X/Y position doesn't save" bug). A page has no open transition, so
  // the equivalent guard is to seed exactly once and never again.
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current) return;
    seededRef.current = true;

    reset(defaults, { keepDirty: false, keepErrors: false, keepTouched: false, keepValues: false });
    setAvatarPreview(user.avatar ? apiPaths.files.pfp(user.avatar) : '');
    setAvatarCrop({
      cropX: user.cropX ?? 0.5,
      cropY: user.cropY ?? 0.5,
      zoom: user.zoom ?? 1,
    });
  }, [defaults, reset, user.avatar, user.cropX, user.cropY, user.zoom]);

  const handleAvatarUpload = (file?: File) => {
    // Update RHF state and local state
    setValue('avatarFile', file, {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    });
    setValue('deleteAvatar', false, { shouldDirty: true });

    // Set preview Avatar
    if (file) {
      const reader = new FileReader();
      reader.onload = () => setAvatarPreview(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  const handleDeleteAvatar = () => {
    setValue('deleteAvatar', true, { shouldDirty: true });
    setAvatarPreview('');
  };

  const resetForm = () =>
    reset(defaults, { keepDirty: false, keepTouched: false, keepErrors: false, keepValues: false });

  const onSubmit = async (values: UpdateProfileInput) => {
    const parsed: UpdateProfileInput = UpdateProfileSchema.parse(values);

    const formData = new FormData();
    formData.append('firstName', parsed.firstName);
    formData.append('lastName', parsed.lastName);
    let avatarToUpload: File | undefined;
    if (parsed.deleteAvatar) {
      avatarToUpload = undefined;
    } else if (parsed.avatarFile instanceof File) {
      avatarToUpload = parsed.avatarFile;
    }
    if (avatarToUpload) formData.append('avatar', avatarToUpload);
    if (parsed.deleteAvatar) formData.append('deleteAvatar', 'true');
    // Always send it: a blank value tells the server to clear the override
    // (Automatic), so the display timezone follows the system/browser again.
    formData.append('timezone', parsed.timezone ?? '');
    formData.append('cropX', String(avatarCrop.cropX));
    formData.append('cropY', String(avatarCrop.cropY));
    formData.append('zoom', String(avatarCrop.zoom));

    try {
      // Post new profile data to database
      const res = await fetch(apiPaths.me(), { method: 'POST', body: formData });
      if (!res.ok) throw new Error('Failed to update profile');

      // Refresh the session so the navbar/sidebar avatars (which read from it) reflect
      // the new photo and crop instantly, no reload needed.
      await updateSession();

      // Kept for any parent that also wants the updated fields.
      await onSave?.({
        firstName: parsed.firstName,
        lastName: parsed.lastName,
        avatar: parsed.deleteAvatar ? null : user.avatar,
        cropX: avatarCrop.cropX,
        cropY: avatarCrop.cropY,
        zoom: avatarCrop.zoom,
        timezone: parsed.timezone || undefined,
      });

      // The display-timezone hook reads /api/me through this cached key; refetch
      // it so a changed (or cleared) timezone takes effect without a reload.
      await queryClient.invalidateQueries({ queryKey: ['profile'] });

      showToast.updated('Profile');
    } catch {
      showToast.error('Could not save your profile. Check your connection and try again.');
    } finally {
      console.log('resetting form');
      resetForm();
    }
  };

  return (
      <form onSubmit={handleSubmit(onSubmit)} className="max-w-md space-y-4">
          {/* Avatar */}
          <div className="flex flex-col items-center gap-3">
            <Label className="w-full text-center">Avatar Image</Label>
            {/* No separate preview: the crop editor below shows the current image. */}
            <input
              id={avatarUploadId}
              ref={avatarInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              aria-invalid={errors.avatarFile?.message ? true : undefined}
              aria-describedby={errors.avatarFile?.message ? avatarErrorId : undefined}
              onChange={(e) => handleAvatarUpload(e.target.files?.[0])}
            />
            <div className="flex w-full gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => avatarInputRef.current?.click()}
                aria-describedby={errors.avatarFile?.message ? avatarErrorId : undefined}
                className="flex flex-1 items-center justify-center gap-2"
              >
                <Upload className="h-4 w-4" />
                Upload Avatar
              </Button>
              {avatarPreview && (
                <Button
                  type="button"
                  variant="outline"
                  className="border-destructive text-destructive hover:bg-destructive/10 flex flex-1 items-center justify-center gap-2"
                  onClick={handleDeleteAvatar}
                >
                  <Trash2 className="h-4 w-4" />
                  Delete Avatar
                </Button>
              )}
            </div>
            {errors.avatarFile?.message && (
              <p id={avatarErrorId} role="alert" className="text-destructive text-xs">
                {typeof errors.avatarFile?.message === 'string'
                  ? errors.avatarFile.message
                  : String(errors.avatarFile?.message)}
              </p>
            )}
          </div>

          {avatarPreview ? (
            <AvatarCrop
              avatarPreview={avatarPreview}
              editorRef={avatarEditorRef}
              cropX={avatarCrop.cropX}
              cropY={avatarCrop.cropY}
              zoom={avatarCrop.zoom}
              onPositionChange={(position) =>
                setAvatarCrop((prev) => ({ ...prev, cropX: position.x, cropY: position.y }))
              }
              onZoomChange={(zoom) => setAvatarCrop((prev) => ({ ...prev, zoom }))}
            />
          ) : null}

          {/* First + last name sit side by side to save vertical space, and stack
              on very small screens. */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Controller
              name="firstName"
              control={control}
              render={({ field }) => (
                <InputGroup
                  label="First Name"
                  name="firstName"
                  fieldProps={field}
                  error={errors.firstName?.message}
                />
              )}
            />

            <Controller
              name="lastName"
              control={control}
              render={({ field }) => (
                <InputGroup
                  label="Last Name"
                  name="lastName"
                  fieldProps={field}
                  error={errors.lastName?.message}
                />
              )}
            />
          </div>

          {/* Timezone */}
          <Controller
            name="timezone"
            control={control}
            render={({ field }) => (
              <SelectField
                label="Timezone"
                name="timezone"
                id="timezone"
                // Empty override renders as "Automatic". Radix needs a non-empty
                // item value, so map '' <-> AUTO_TIMEZONE across the boundary.
                value={field.value ? field.value : AUTO_TIMEZONE}
                onValueChange={(v) => field.onChange(v === AUTO_TIMEZONE ? '' : v)}
                placeholder="Select timezone"
                description={`Automatic follows this device's timezone (currently ${browserTimezone}).`}
                options={[
                  { value: AUTO_TIMEZONE, label: 'Automatic (detect from browser)' },
                  ...COMMON_TIMEZONES.map((tz) => ({
                    value: tz,
                    label: formatTimezoneLabel(tz),
                  })),
                ]}
              />
            )}
          />

          {/* Email (read-only) */}
          <InputGroup
            label="Email"
            name="email"
            value={user.email}
            type="email"
            disabled
            description="Email cannot be changed."
          />

          {/* Hidden deleteAvatar flag (driven by Delete button) */}
          <Controller control={control} name="deleteAvatar" render={() => <></>} />

        <div className="mt-4 flex gap-2">
          <Button
            type="submit"
            disabled={!isValid || isSubmitting}
            title={!isValid ? 'Fix validation errors to save' : undefined}
          >
            {isSubmitting ? 'Saving...' : 'Save changes'}
          </Button>
          <Button type="button" variant="secondary" onClick={resetForm} disabled={isSubmitting}>
            Reset
          </Button>
        </div>
      </form>
  );
}

export default ProfileSection;
