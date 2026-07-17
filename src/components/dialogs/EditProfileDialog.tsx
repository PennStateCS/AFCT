import { useEffect, useMemo, useRef, useState } from 'react';
import { getInitials } from '@/app/utils/initials';
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
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Label } from '@/components/ui/label';
import { AvatarCrop, type AvatarCropRef } from '../AvatarCrop';
import { Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';

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

type EditProfileDialog = {
  user: ProfileUser;
  open: boolean;
  setOpen: (open: boolean) => void;
  onSave?: (updatedUser: Partial<ProfileUser>) => Promise<void>;
};
export function EditProfileDialog({ user, open, setOpen, onSave }: EditProfileDialog) {
  // Local preview state (keep separate from RHF file)
  const queryClient = useQueryClient();
  // The navbar/sidebar avatars read from the NextAuth session; update() re-runs the
  // session callback (which re-reads the user from the DB), so the new photo/crop
  // appears immediately without a page reload.
  const { update: updateSession } = useSession();
  const avatarEditorRef = useRef<AvatarCropRef['current']>(null);
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

  // Load profile on open
  useEffect(() => {
    if (open) {
      reset(defaults, {
        keepDirty: false,
        keepErrors: false,
        keepTouched: false,
        keepValues: false,
      });
      // Reset preview from current user
      setAvatarPreview(user.avatar ? apiPaths.files.pfp(user.avatar) : '');
      setAvatarCrop({
        cropX: user.cropX ?? 0.5,
        cropY: user.cropY ?? 0.5,
        zoom: user.zoom ?? 1,
      });
    } else {
      reset(defaults, {
        keepDirty: false,
        keepTouched: false,
        keepErrors: false,
        keepValues: false,
      });
      setAvatarCrop({
        cropX: user.cropX ?? 0.5,
        cropY: user.cropY ?? 0.5,
        zoom: user.zoom ?? 1,
      });
    }
  }, [open, defaults, reset, user.avatar, user.cropX, user.cropY, user.zoom]);

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

      toast.success('Profile updated!');
      setOpen(false);
    } catch {
      toast.error('Failed to update profile.');
    } finally {
      console.log('resetting form');
      resetForm();
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(val) => {
        setOpen(val);
        // Prevent “red fields on cancel”: clear RHF UI state on close
        if (!val) {
          resetForm();
        }
      }}
    >
      <DialogContent className="bg-card max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit Profile</DialogTitle>
          <DialogDescription>Update your personal information.</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {/* Avatar */}
          <div className="flex flex-col items-center gap-3">
            <Label className="text-center w-full">Avatar Image</Label>
            <div className="flex items-center justify-center gap-4 w-full">
              <Avatar className="h-20 w-20">
                <AvatarImage
                  src={avatarPreview || undefined}
                  alt="User Avatar"
                  cropX={avatarCrop.cropX}
                  cropY={avatarCrop.cropY}
                  zoom={avatarCrop.zoom}
                />
                <AvatarFallback className="bg-secondary text-secondary-foreground">
                  {getInitials(user.firstName, user.lastName, user.email)}
                </AvatarFallback>
              </Avatar>

              <div className="flex w-full max-w-xs flex-col gap-3">
                <input
                  id="avatar-upload"
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => handleAvatarUpload(e.target.files?.[0])}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => document.getElementById('avatar-upload')?.click()}
                  className="flex items-center gap-2"
                >
                  <Upload className="h-4 w-4" />
                  Upload Avatar
                </Button>
                {errors.avatarFile?.message && (
                  <p className="mt-1 text-xs text-red-600">
                    {typeof errors.avatarFile?.message === 'string'
                      ? errors.avatarFile.message
                      : String(errors.avatarFile?.message)}
                  </p>
                )}

                {avatarPreview && (
                  <Button
                    type="button"
                    variant="outline"
                    className="flex items-center gap-2 border-red-600 text-red-600 hover:bg-red-50"
                    onClick={handleDeleteAvatar}
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete Avatar
                  </Button>
                )}
              </div>
            </div>
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

          {/* First Name */}
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

          {/* Last Name */}
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

          <DialogFooter className="mt-4">
            <DialogClose asChild>
              <Button type="button" variant="secondary" onClick={resetForm} disabled={isSubmitting}>
                Cancel
              </Button>
            </DialogClose>
            <Button
              type="submit"
              disabled={!isValid || isSubmitting}
              title={!isValid ? 'Fix validation errors to save' : undefined}
            >
              {isSubmitting ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
