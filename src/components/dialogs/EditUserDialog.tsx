'use client';

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
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Label } from '@/components/ui/label';
import InputGroup from '@/components/ui/InputGroup';
import SelectField from '@/components/ui/SelectField';
import { Upload, Trash2 } from 'lucide-react';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useSession } from 'next-auth/react';

import type { User } from '@prisma/client';
import { UpdateUserSchema, type UpdateUserRaw, type UpdateUserInput } from '@/schemas/user';
import { COMMON_TIMEZONES, formatTimezoneLabel } from '@/lib/timezones';
import { useEffectiveTimezone } from '@/hooks/use-effective-timezone';
import { apiPaths } from '@/lib/api-paths';
import { AvatarCrop, type AvatarCropRef } from '../AvatarCrop';

type UserWithAdmin = User & { isAdmin?: boolean };

type EditUserDialogProps = {
  user: UserWithAdmin;
  open: boolean;
  setOpen: (open: boolean) => void;
  onSave?: (updatedUser: Partial<UserWithAdmin>) => Promise<void>;
};

export function EditUserDialog({ user, open, setOpen, onSave }: EditUserDialogProps) {
  const { timezone: effectiveTimezone } = useEffectiveTimezone();
  // Only system admins may see/change the admin flag; the backend enforces this too.
  const { data: session } = useSession();
  const avatarEditorRef = useRef<AvatarCropRef['current']>(null);
  const [avatarDirty, setAvatarDirty] = useState(false);
  const viewerIsAdmin = Boolean(session?.user?.isAdmin);
  // Local preview state (keep separate from RHF file)
  const [avatarPreview, setAvatarPreview] = useState<string>(
    user.avatar ? apiPaths.files.pfp(user.avatar) : '',
  );
  const [serverTimezone, setServerTimezone] = useState('UTC');

  // RHF defaults – email is read-only so it isn't in the schema
  const defaults: UpdateUserRaw = useMemo(
    () => ({
      firstName: user.firstName ?? '',
      lastName: user.lastName ?? '',
      isAdmin: user.isAdmin ?? false,
      timezone: user.timezone ?? '',
      avatarFile: undefined,
      deleteAvatar: false,
      inactive: user.inactive ?? false,
    }),
    [user],
  );

  const {
    control,
    handleSubmit,
    reset,
    watch,
    setValue,
    getValues,
    formState: { errors, isSubmitting, isValid },
  } = useForm<UpdateUserRaw>({
    resolver: zodResolver(UpdateUserSchema),
    defaultValues: defaults,
    mode: 'onChange',
    reValidateMode: 'onChange',
  });

  // Reset form (avoid error flash on close)
  useEffect(() => {
    if (open) {
      reset(defaults, {
        keepDirty: false,
        keepTouched: false,
        keepErrors: false,
        keepValues: true,
      });
      // Reset preview from current user
      setAvatarPreview(user.avatar ? apiPaths.files.pfp(user.avatar) : '');
      setAvatarDirty(false);
    } else {
      reset(defaults, {
        keepDirty: false,
        keepTouched: false,
        keepErrors: false,
        keepValues: false,
      });
      setAvatarDirty(false);
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

  const avatarFileErrorMessage = (() => {
    const e = errors.avatarFile;
    if (!e) return '';
    if (typeof e === 'string') return e;
    if (typeof e === 'object' && e !== null) {
      const m = (e as { message?: unknown }).message;
      if (typeof m === 'string') return m;
    }
    try {
      return JSON.stringify(e);
    } catch {
      return String(e);
    }
  })();

  // Avatar upload handler: set file in RHF + update local preview + clear delete flag
  const onAvatarPicked = (file?: File) => {
    // Update RHF state and local state
    setValue('avatarFile', file, {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    });
    setValue('deleteAvatar', false, { shouldDirty: true });
    setAvatarDirty(true);

    // Set preview Avatar
    if (file) {
      const reader = new FileReader();
      reader.onload = () => setAvatarPreview(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  const onDeleteAvatar = () => {
    setValue('avatarFile', undefined, { shouldDirty: true });
    setValue('deleteAvatar', true, { shouldDirty: true });
    setAvatarDirty(false);
    setAvatarPreview('');
  };

  const getCroppedAvatarFile = async () => {
    const editor = avatarEditorRef.current;
    if (!editor) return null;
    const canvas = editor.getImageScaledToCanvas();
    return new Promise<File | null>((resolve) => {
      canvas.toBlob((blob: Blob | null) => {
        if (!blob) return resolve(null);
        resolve(new File([blob], 'avatar.png', { type: 'image/png' }));
      }, 'image/png');
    });
  };

  const resetForm = () =>
    reset(defaults, { keepDirty: false, keepTouched: false, keepErrors: false, keepValues: false });

  const onSubmit = async (raw: UpdateUserRaw) => {
    const parsed: UpdateUserInput = UpdateUserSchema.parse(raw);

    const formData = new FormData();
    formData.append('firstName', parsed.firstName);
    formData.append('lastName', parsed.lastName);
    let avatarToUpload: File | undefined;
    if (parsed.deleteAvatar) {
      // deleteAvatar takes precedence over any editor state
      avatarToUpload = undefined;
    } else if (avatarDirty) {
      avatarToUpload = await getCroppedAvatarFile() || undefined;
    } else if (parsed.avatarFile instanceof File) {
      avatarToUpload = parsed.avatarFile;
    }
    if (avatarToUpload) formData.append('avatar', avatarToUpload);
    if (parsed.deleteAvatar) formData.append('deleteAvatar', 'true');
    formData.append('inactive', parsed.inactive ? 'true' : 'false');
    if (parsed.timezone) formData.append('timezone', parsed.timezone);
    // Only admins can set this; the backend ignores it from non-admins regardless.
    if (viewerIsAdmin) formData.append('isAdmin', parsed.isAdmin ? 'true' : 'false');

    const res = await fetch(apiPaths.user(user.id), {
      method: 'PATCH',
      body: formData,
    });

    // Read the response body
    const body = await res.json();

    // End if there was an error
    if (!res.ok) {
      showToast.error(body?.error || 'Failed to update user.');
      return;
    }

    // Backend succeeded, now notify parent
    await onSave?.({
      ...user,
      firstName: parsed.firstName,
      lastName: parsed.lastName,
      isAdmin: viewerIsAdmin ? parsed.isAdmin : user.isAdmin,
      avatar: parsed.deleteAvatar ? null : user.avatar,
      inactive: parsed.inactive,
      timezone: parsed.timezone || undefined,
    });

    resetForm();
    setOpen(false);
    showToast.success('User updated successfully.');
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(val) => {
        setOpen(val);
        if (!val) resetForm();
      }}
    >
      <DialogContent className="bg-card">
        <DialogHeader>
          <DialogTitle>Edit User</DialogTitle>
          <DialogDescription>Modify the user’s information and profile photo.</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {/* Avatar block */}
          <div className="flex flex-col items-center gap-3">
            <Label className="text-center w-full">Avatar Image</Label>
            <div className="flex items-center justify-center gap-4 w-full">
              <Avatar className="h-20 w-20">
                <AvatarImage src={avatarPreview || undefined} alt="User Avatar" />
                <AvatarFallback className="bg-secondary text-secondary-foreground">
                  {(watch('firstName') || user.firstName || '?').charAt(0)}
                  {(watch('lastName') || user.lastName || '?').charAt(0)}
                </AvatarFallback>
              </Avatar>

              <div className="flex w-full max-w-xs flex-col gap-3">
                <Controller
                  control={control}
                  name="avatarFile"
                  render={() => (
                    <>
                      <input
                        id="avatar-upload"
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => onAvatarPicked(e.target.files?.[0])}
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
                      {avatarFileErrorMessage && (
                        <p className="mt-1 text-xs text-red-600">{avatarFileErrorMessage}</p>
                      )}
                    </>
                  )}
                />

                {avatarPreview && (
                  <Button
                    type="button"
                    variant="outline"
                    className="flex items-center gap-2 border-red-600 text-red-600 hover:bg-red-50"
                    onClick={onDeleteAvatar}
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
              onChange={() => setAvatarDirty(true)}
            />
          ) : null}

          {/* First name */}
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

          {/* Last name */}
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

          {/* Timezone */}
          <Controller
            control={control}
            name="timezone"
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
          <div>
            <label className="mb-2 block text-sm font-medium">Email</label>
            <input
              type="email"
              value={user.email}
              disabled
              readOnly
              className="w-full cursor-not-allowed rounded border bg-gray-200 p-2 text-sm opacity-70"
            />
          </div>

          {/* Administrator flag (system admins only) */}
          {viewerIsAdmin && (
            <Controller
              control={control}
              name="isAdmin"
              render={({ field }) => (
                <SelectField
                  label="Administrator"
                  name="isAdmin"
                  value={field.value ? 'true' : 'false'}
                  onValueChange={(v) => field.onChange(v === 'true')}
                  placeholder="Select administrator access"
                  options={[
                    { value: 'false', label: 'No' },
                    { value: 'true', label: 'Yes' },
                  ]}
                  error={errors.isAdmin?.message}
                />
              )}
            />
          )}

          {/* Inactive */}
          <Controller
            control={control}
            name="inactive"
            render={({ field }) => (
              <SelectField
                label="Status"
                name="inactive"
                value={field.value ? 'true' : 'false'}
                onValueChange={(v) => field.onChange(v === 'true')}
                placeholder="Select activity type"
                options={[
                  { value: 'false', label: 'Active' },
                  { value: 'true', label: 'Inactive' },
                ]}
                error={errors.inactive?.message}
              />
            )}
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
              {isSubmitting ? 'Saving…' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
