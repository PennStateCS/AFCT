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
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import InputGroup from '@/components/ui/InputGroup';
import { UploadCloud, Trash2 } from 'lucide-react';

import { useEffect, useMemo, useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

import type { User } from '@prisma/client';
import { UpdateUserSchema, type UpdateUserRaw, type UpdateUserInput } from '@/schemas/user';
import { roleOptions, formatRole } from '@/lib/roles';
import { COMMON_TIMEZONES, formatTimezoneLabel } from '@/lib/timezones';

type EditUserDialogProps = {
  user: User;
  open: boolean;
  setOpen: (open: boolean) => void;
  onSave?: (updatedUser: Partial<User>) => Promise<void>;
};

export function EditUserDialog({ user, open, setOpen, onSave }: EditUserDialogProps) {
  // Local preview state (keep separate from RHF file)
  const [avatarPreview, setAvatarPreview] = useState<string>(
    user.avatar ? `/uploads/pfps/${user.avatar}` : '/uploads/pfps/default-avatar.png',
  );
  const [serverTimezone, setServerTimezone] = useState('UTC');

  // RHF defaults – email is read-only so it isn't in the schema
  const defaults: UpdateUserRaw = useMemo(
    () => ({
      firstName: user.firstName ?? '',
      lastName: user.lastName ?? '',
      role: user.role,
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
    formState: { errors, isSubmitting, isValid, isDirty },
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
      setAvatarPreview(user.avatar ? `/uploads/pfps/${user.avatar}` : '/uploads/pfps/default-avatar.png');
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
    const loadServerTimezone = async () => {
      try {
        const res = await fetch('/api/system-settings/public', { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        const tz = String(data?.timezone ?? 'UTC');
        setServerTimezone(tz);
        const current = getValues('timezone');
        if (!current) {
          setValue('timezone', tz, { shouldDirty: false });
        }
      } catch {
        // ignore
      }
    };
    loadServerTimezone();
  }, [open, getValues, setValue]);

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

    // Set preview Avatar
    if (file) {
      const reader = new FileReader();
      reader.onload = () => setAvatarPreview(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  const onDeleteAvatar = () => {
    setAvatarPreview('/uploads/pfps/default-avatar.png');
    setValue('avatarFile', undefined, { shouldDirty: true });
    setValue('deleteAvatar', true, { shouldDirty: true });
  };

  const resetForm = () =>
    reset(defaults, { keepDirty: false, keepTouched: false, keepErrors: false, keepValues: false });

  const onSubmit = async (raw: UpdateUserRaw) => {
    const parsed: UpdateUserInput = UpdateUserSchema.parse(raw);

    const formData = new FormData();
    formData.append('firstName', parsed.firstName);
    formData.append('lastName', parsed.lastName);
    formData.append('role', parsed.role);
    if (parsed.avatarFile instanceof File) formData.append('avatar', parsed.avatarFile);
    if (parsed.deleteAvatar) formData.append('deleteAvatar', 'true');
    formData.append('inactive', parsed.inactive ? 'true' : 'false');
    if (parsed.timezone) formData.append('timezone', parsed.timezone);

    const res = await fetch(`/api/users/${user.id}`, {
      method: 'PATCH',
      body: formData,
    });

    // Read the response body
    const body = await res.json();

    // End if there was an error
    if (!res.ok) {
      showToast.error(body?.error || "Failed to update user.");
      return;
    }

    // Backend succeeded, now notify parent
    await onSave?.({
      ...user,
      firstName: parsed.firstName,
      lastName: parsed.lastName,
      role: parsed.role as 'ADMIN' | 'FACULTY' | 'TA' | 'STUDENT',
      avatar: parsed.deleteAvatar ? null : user.avatar,
      inactive: parsed.inactive,
      timezone: parsed.timezone || undefined,
    });

    resetForm();
    setOpen(false);
    showToast.success("User updated successfully.");
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
          <div className="flex items-center gap-4">
            <Avatar className="h-20 w-20">
              <AvatarImage src={avatarPreview} alt="User Avatar" />
              <AvatarFallback className="bg-secondary text-secondary-foreground">
                {(watch('firstName') || user.firstName || '?').charAt(0)}
                {(watch('lastName') || user.lastName || '?').charAt(0)}
              </AvatarFallback>
            </Avatar>

            <div className="flex flex-col gap-2">
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
                      <UploadCloud className="h-4 w-4" />
                      Upload Avatar
                    </Button>
                    {avatarFileErrorMessage && (
                      <p className="mt-1 text-xs text-red-600">{avatarFileErrorMessage}</p>
                    )}
                  </>
                )}
              />

              {avatarPreview && avatarPreview !== '/uploads/pfps/default-avatar.png' && (
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
              <div>
                <label className="mb-2 block text-sm font-medium" htmlFor="timezone">
                  Timezone
                </label>
                <Select value={field.value || serverTimezone} onValueChange={(v) => field.onChange(v)}>
                  <SelectTrigger className="w-full" id="timezone">
                    <SelectValue placeholder="Select timezone" />
                  </SelectTrigger>
                  <SelectContent>
                    {COMMON_TIMEZONES.map((tz) => (
                      <SelectItem key={tz} value={tz}>
                        {formatTimezoneLabel(tz)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
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

          {/* Default Role */}
          <Controller
            control={control}
            name="role"
            render={({ field }) => {
              return (
                <div>
                  <label className="mb-2 block text-sm font-medium">Default Role</label>
                  <Select value={field.value} onValueChange={(v) => field.onChange(v)}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select a default role" />
                    </SelectTrigger>
                    <SelectContent>
                      {roleOptions.map((r) => (
                        <SelectItem key={r} value={r}>
                          {formatRole(r)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {errors.role && <p className="mt-1 text-xs text-red-600">{errors.role.message}</p>}
                </div>
              );
            }}
          />

          {/* Inactive */}
          <Controller
            control={control}
            name="inactive"
            render={({ field }) => (
              <div>
                <label className="mb-2 block text-sm font-medium">Status</label>
                <Select value={field.value ? 'true' : 'false'} onValueChange={(v) => field.onChange(v === 'true')}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select activity type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="false">Active</SelectItem>
                    <SelectItem value="true">Inactive</SelectItem>
                  </SelectContent>
                </Select>
                {errors.inactive && <p className="mt-1 text-xs text-red-600">{errors.inactive.message}</p>}
              </div>
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
              disabled={!isValid || !isDirty || isSubmitting}
              title={
                !isValid
                  ? 'Fix validation errors to save'
                  : !isDirty
                    ? 'No changes to save'
                    : undefined
              }
            >
              {isSubmitting ? 'Saving…' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
