import { useEffect, useMemo, useState } from 'react';
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
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import InputGroup from '@/components/ui/InputGroup';
import SelectField from '@/components/ui/SelectField';
import FileUploadInput from '@/components/FileUploadInput';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

import type { SessionUser } from '@/types/next-auth';
import {
  UpdateProfileSchema,
  type UpdateProfileRaw,
  type UpdateProfileInput,
} from '@/schemas/profile';
import { COMMON_TIMEZONES, formatTimezoneLabel } from '@/lib/timezones';
import { useEffectiveTimezone } from '@/hooks/use-effective-timezone';
import { useMaxUploadSize } from '@/hooks/useMaxUploadSize';
import { apiPaths } from '@/lib/api-paths';

type EditProfileDialog = {
  user: SessionUser;
  open: boolean;
  setOpen: (open: boolean) => void;
  onSave?: (updatedUser: Partial<SessionUser>) => Promise<void>;
};
export function EditProfileDialog({ user, open, setOpen, onSave }: EditProfileDialog) {
  // Local preview state (keep separate from RHF file)
  const { timezone: effectiveTimezone } = useEffectiveTimezone();
  const { maxMb, loading: loadingMaxSize } = useMaxUploadSize();
  const [avatarPreview, setAvatarPreview] = useState<string>(
    user.avatar ? apiPaths.files.pfp(user.avatar) : '',
  );
  const [serverTimezone, setServerTimezone] = useState('UTC');

  // RHF defaults – email is read-only so it isn't in the schema
  const defaults: UpdateProfileRaw = useMemo(
    () => ({
      firstName: user.firstName ?? '',
      lastName: user.lastName ?? '',
      timezone: user.timezone ?? '',
      avatarFile: undefined,
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
    getValues,
    formState: { errors, isSubmitting, isValid },
  } = useForm<UpdateProfileRaw>({
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
    } else {
      reset(defaults, {
        keepDirty: false,
        keepTouched: false,
        keepErrors: false,
        keepValues: false,
      });
    }
  }, [open, defaults, reset, user.avatar]);

  useEffect(() => {
    if (!open) return;
    const tz = user.timezone || effectiveTimezone || 'UTC';
    setServerTimezone(effectiveTimezone || 'UTC');
    if (!getValues('timezone')) {
      setValue('timezone', tz, { shouldDirty: false });
    }
  }, [open, user.timezone, effectiveTimezone, getValues, setValue]);

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
  };

  const resetForm = () =>
    reset(defaults, { keepDirty: false, keepTouched: false, keepErrors: false, keepValues: false });

  const onSubmit = async (values: UpdateProfileInput) => {
    const parsed: UpdateProfileInput = UpdateProfileSchema.parse(values);

    const formData = new FormData();
    formData.append('firstName', parsed.firstName);
    formData.append('lastName', parsed.lastName);
    if (parsed.avatarFile) formData.append('avatar', parsed.avatarFile);
    if (parsed.deleteAvatar) formData.append('deleteAvatar', 'true');
    if (parsed.timezone) formData.append('timezone', parsed.timezone);

    try {
      // Post new profile data to database
      const res = await fetch(apiPaths.me(), { method: 'POST', body: formData });
      if (!res.ok) throw new Error('Failed to update profile');

      // Use NextAuth's update function to immediately update the session
      await onSave?.({
        firstName: parsed.firstName,
        lastName: parsed.lastName,
        avatar: parsed.deleteAvatar ? null : user.avatar,
        timezone: parsed.timezone || undefined,
      });

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
          <DialogDescription>Update your personal information and avatar.</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {/* Avatar */}
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-4">
              <Avatar className="h-20 w-20">
                <AvatarImage src={avatarPreview || undefined} alt="User Avatar" />
                <AvatarFallback className="bg-secondary text-secondary-foreground">
                  {getInitials(user.firstName, user.lastName, user.email)}
                </AvatarFallback>
              </Avatar>

              <div className="flex flex-col gap-2">
                {
                  <Button
                    type="button"
                    variant="outline"
                    className="flex items-center gap-2 border-red-600 text-red-600 hover:bg-red-50"
                    onClick={handleDeleteAvatar}
                    size="sm"
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete Avatar
                  </Button>
                }
              </div>
            </div>

            <Controller
              control={control}
              name="avatarFile"
              render={({ field: { onChange, value } }) => (
                <FileUploadInput
                  id="avatar-file"
                  name="avatarFile"
                  label="Avatar Image"
                  accept="image/*"
                  maxSizeMb={maxMb}
                  value={value}
                  onChange={(file) => {
                    handleAvatarUpload(file);
                    onChange(file);
                  }}
                  error={
                    typeof errors.avatarFile?.message === 'string'
                      ? errors.avatarFile.message
                      : undefined
                  }
                  disabled={loadingMaxSize}
                  description="Recommended: square image, at least 256x256px"
                />
              )}
            />
          </div>

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
                value={field.value || serverTimezone}
                onValueChange={(v) => field.onChange(v)}
                placeholder="Select timezone"
                options={COMMON_TIMEZONES.map((tz) => ({
                  value: tz,
                  label: formatTimezoneLabel(tz),
                }))}
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
