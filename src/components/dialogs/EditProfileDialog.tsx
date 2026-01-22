import { use, useEffect, useMemo, useState } from 'react';
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
import { UploadCloud, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import InputGroup from '@/components/ui/InputGroup';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

import type { User } from '@prisma/client';
import { UpdateProfileSchema, type UpdateProfileRaw, type UpdateProfileInput } from '@/schemas/profile';

type EditProfileDialog = {
  user: User;
  open: boolean;
  setOpen: (open: boolean) => void;
  onSave?: (updatedUser: Partial<User>) => Promise<void>;
};

export function EditProfileDialog({ user, open, setOpen, onSave }: EditProfileDialog) {
  // Local preview state (keep separate from RHF file)
  const [avatarPreview, setAvatarPreview] = useState<string>(
    user.avatar ? `/api/files/avatar?file=${user.avatar}` : '/api/files/avatar?file=default-avatar.png',
  );

  // RHF defaults – email is read-only so it isn't in the schema
  const defaults: UpdateProfileRaw = useMemo(
    () => ({
      firstName: user.firstName ?? '',
      lastName: user.lastName ?? '',
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
    watch,
    setValue,
    formState: { errors, isSubmitting, isValid, isDirty },
  } = useForm<UpdateProfileRaw>({
    resolver: zodResolver(UpdateProfileSchema),
    defaultValues: defaults,
    mode: 'onBlur',
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
      setAvatarPreview(user.avatar ? `/api/files/avatar?file=${user.avatar}` : '/api/files/avatar?file=default-avatar.png');
    } else {
      reset(defaults, {
        keepDirty: false,
        keepTouched: false,
        keepErrors: false,
        keepValues: false,
      });
    }
  }, [open, defaults, reset, user.avatar]);

  // Avatar error message extraction
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
    setAvatarPreview('/api/files/avatar?=default-avatar.png');
    setValue('avatarFile', undefined, { shouldDirty: true });
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

    try {
      // Post new profile data to database
      const res = await fetch('/api/profile', { method: 'POST', body: formData });
      if (!res.ok) throw new Error('Failed to update profile');

      // Use NextAuth's update function to immediately update the session
      await onSave?.({
        firstName: parsed.firstName,
        lastName: parsed.lastName,
        avatar: parsed.deleteAvatar ? null : user.avatar,
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
        if (!val) { resetForm(); }
      }}
    >
      <DialogContent className="bg-card max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit Profile</DialogTitle>
          <DialogDescription>Update your personal information and avatar.</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {/* Avatar */}
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
                      onChange={(e) => handleAvatarUpload(e.target.files?.[0])}
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

              {avatarPreview && avatarPreview !== '/api/files/avatar?=default-avatar.png' && (
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
              disabled={!isValid || !isDirty || isSubmitting}
              title={
                !isValid
                  ? 'Fix validation errors to save'
                  : !isDirty
                    ? 'No changes to save'
                    : undefined
              }
            >
              {isSubmitting ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
