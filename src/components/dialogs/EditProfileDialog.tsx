import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { UploadCloud, Trash2 } from 'lucide-react';
import { useSession } from 'next-auth/react';
import { toast } from 'sonner';

import InputGroup from '@/components/ui/InputGroup';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { UpdateProfileSchema, type UpdateProfileInput } from '@/schemas/profile';

type Props = {
  open: boolean;
  setOpen: (open: boolean) => void;
};

export function EditProfileDialog({ open, setOpen }: Props) {
  const { status, update } = useSession();

  // Avatar/file/UI state
  const [email, setEmail] = useState('');
  const [avatar, setAvatar] = useState<string>('');
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [deleteAvatar, setDeleteAvatar] = useState(false);
  const [loading, setLoading] = useState(false);

  // RHF with Zod
  const {
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<UpdateProfileInput>({
    resolver: zodResolver(UpdateProfileSchema),
    defaultValues: { firstName: '', lastName: '' },
    mode: 'onBlur',
    reValidateMode: 'onChange',
  });

  // Load profile on open
  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const res = await fetch('/api/profile');
        if (!res.ok) throw new Error('Failed to load profile');
        const data = await res.json();
        reset(
          { firstName: data.firstName ?? '', lastName: data.lastName ?? '' },
          {
            keepDirty: false,
            keepErrors: false,
            keepTouched: false,
          },
        );
        setEmail(data.email ?? '');
        setAvatar(data.avatar ? `/uploads/${data.avatar}?t=${Date.now()}` : '/default-avatar.png');
        setAvatarFile(null);
        setDeleteAvatar(false);
      } catch {
        toast.error('Failed to load profile.');
      }
    };

    if (open && status === 'authenticated') fetchProfile();
  }, [open, status, reset]);

  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setAvatarFile(file);
      setDeleteAvatar(false);
      const reader = new FileReader();
      reader.onload = () => setAvatar(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  const handleDeleteAvatar = () => {
    setAvatar('/default-avatar.png');
    setAvatarFile(null);
    setDeleteAvatar(true);
  };

  const onSubmit = async (values: UpdateProfileInput) => {
    setLoading(true);
    const formData = new FormData();
    formData.append('firstName', values.firstName.trim());
    formData.append('lastName', values.lastName.trim());
    if (avatarFile) formData.append('avatar', avatarFile);
    if (deleteAvatar) formData.append('deleteAvatar', 'true');

    try {
      const res = await fetch('/api/profile', { method: 'POST', body: formData });
      if (!res.ok) throw new Error('Failed to update profile');

      const updatedUser = await res.json();

      // Use NextAuth's update function to immediately update the session
      await update({
        firstName: updatedUser.firstName,
        lastName: updatedUser.lastName,
        avatar: updatedUser.avatar,
        name: `${updatedUser.firstName || ''} ${updatedUser.lastName || ''}`.trim()
      });
      
      toast.success('Profile updated!');
      setOpen(false);
    } catch {
      toast.error('Failed to update profile.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(val) => {
        // Prevent “red fields on cancel”: clear RHF UI state on close
        if (!val) {
          reset(undefined, {
            keepDirty: false,
            keepTouched: false,
            keepErrors: false,
            keepValues: true, // keep what user typed until re-open fetch refreshes it
          });
        }
        setOpen(val);
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
              <AvatarImage src={avatar || '/default-avatar.png'} alt="Avatar" />
              <AvatarFallback>
                {/* fallback initials update as user types */}
                <Controller
                  name="firstName"
                  control={control}
                  render={({ field }) => (
                    <>
                      {field.value?.[0] || ''}
                      <Controller
                        name="lastName"
                        control={control}
                        render={({ field: lf }) => <>{lf.value?.[0] || ''}</>}
                      />
                    </>
                  )}
                />
              </AvatarFallback>
            </Avatar>

            <div className="flex flex-col gap-2">
              <input
                id="avatar-upload"
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleAvatarUpload}
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

              {avatar && avatar !== '/default-avatar.png' && (
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
            value={email}
            type="email"
            disabled
            description="Email cannot be changed."
          />

          <DialogFooter className="mt-4">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                reset(undefined, {
                  keepDirty: false,
                  keepTouched: false,
                  keepErrors: false,
                });
                setOpen(false);
              }}
              disabled={loading || isSubmitting}
            >
              Cancel
            </Button>

            <Button type="submit" disabled={loading || isSubmitting || !isDirty}>
              {loading || isSubmitting ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
