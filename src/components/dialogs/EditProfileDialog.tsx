'use client';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { UploadCloud, Trash2 } from 'lucide-react';
import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { toast } from 'sonner';

type Props = {
  open: boolean;
  setOpen: (open: boolean) => void;
};

export function EditProfileDialog({ open, setOpen }: Props) {
  const { data: session, status, update } = useSession();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [avatar, setAvatar] = useState<string>('');
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [deleteAvatar, setDeleteAvatar] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open && status === 'authenticated') {
      fetchProfile();
    }
  }, [open, status]);

  const fetchProfile = async () => {
    const res = await fetch('/api/profile');
    if (res.ok) {
      const data = await res.json();
      setFirstName(data.firstName || '');
      setLastName(data.lastName || '');
      setEmail(data.email || '');
      setAvatar(data.avatar ? `/uploads/${data.avatar}?t=${Date.now()}` : '');
    } else {
      toast.error('Failed to load profile.');
    }
  };

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

  const handleSave = async () => {
    if (!firstName.trim() || !lastName.trim()) {
      toast.error('First and last name cannot be blank.');
      return;
    }

    setLoading(true);
    const formData = new FormData();
    formData.append('firstName', firstName.trim());
    formData.append('lastName', lastName.trim());
    if (avatarFile) formData.append('avatar', avatarFile);
    if (deleteAvatar) formData.append('deleteAvatar', 'true');

    try {
      const res = await fetch('/api/profile', { method: 'POST', body: formData });
      if (res.ok) {
        const updatedUser = await res.json();

        // ✅ Update session with latest values
        await update({
          user: {
            ...session?.user,
            firstName: updatedUser.firstName,
            lastName: updatedUser.lastName,
            avatar: updatedUser.avatar,
            name: `${updatedUser.firstName ?? ''} ${updatedUser.lastName ?? ''}`.trim(),
            image: updatedUser.avatar,
          },
        });

        toast.success('Profile updated!');
        setOpen(false);
      } else {
        toast.error('Failed to update profile.');
      }
    } catch {
      toast.error('Something went wrong.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="bg-card max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit Profile</DialogTitle>
          <DialogDescription>Update your personal information and avatar.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <Avatar className="h-20 w-20">
              <AvatarImage src={avatar || '/default-avatar.png'} alt="Avatar" />
              <AvatarFallback>
                {firstName?.charAt(0)}
                {lastName?.charAt(0)}
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
                variant="outline"
                onClick={() => document.getElementById('avatar-upload')?.click()}
                className="flex items-center gap-2"
              >
                <UploadCloud className="h-4 w-4" />
                Upload Avatar
              </Button>

              {avatar && avatar !== '/default-avatar.png' && (
                <Button
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

          <div>
            <Label htmlFor="firstName">First Name</Label>
            <Input
              id="firstName"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
            />
          </div>

          <div>
            <Label htmlFor="lastName">Last Name</Label>
            <Input id="lastName" value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </div>

          <div>
            <Label htmlFor="email">Email</Label>
            <Input id="email" value={email} disabled className="cursor-not-allowed opacity-70" />
          </div>
        </div>

        <DialogFooter className="mt-4">
          <Button variant="secondary" onClick={() => setOpen(false)} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={loading}>
            {loading ? 'Saving...' : 'Save Changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
