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
import { User, Role } from '@prisma/client';
import { useState } from 'react';
import InputGroup from '@/components/ui/InputGroup';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { UploadCloud, Trash2 } from 'lucide-react';

type EditUserDialogProps = {
  user: User;
  open: boolean;
  setOpen: (open: boolean) => void;
  onSave?: (updatedUser: Partial<User>) => Promise<void>;
};

export function EditUserDialog({ user, open, setOpen, onSave }: EditUserDialogProps) {
  const [firstName, setFirstName] = useState(user.firstName);
  const [lastName, setLastName] = useState(user.lastName);
  const [role, setRole] = useState<Role>(user.role);
  const [avatar, setAvatar] = useState<string>(
    user.avatar ? `/uploads/${user.avatar}` : '/default-avatar.png',
  );
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [deleteAvatar, setDeleteAvatar] = useState(false);

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

  const handleSubmit = async () => {
    const formData = new FormData();
    formData.append('firstName', firstName);
    formData.append('lastName', lastName);
    formData.append('role', role);
    if (avatarFile) formData.append('avatar', avatarFile);
    if (deleteAvatar) formData.append('deleteAvatar', 'true');

    await fetch(`/api/users/${user.id}`, {
      method: 'PATCH',
      body: formData,
    });

    await onSave?.({
      ...user,
      firstName,
      lastName,
      role,
      avatar: deleteAvatar ? null : user.avatar,
    });

    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="bg-card">
        <DialogHeader>
          <DialogTitle>Edit User</DialogTitle>
          <DialogDescription>Modify the user’s information and profile photo.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <Avatar className="h-20 w-20">
              <AvatarImage src={avatar} alt="User Avatar" />
              <AvatarFallback className="bg-secondary text-secondary-foreground">
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

          <InputGroup label="First Name" value={firstName} setValue={setFirstName} />
          <InputGroup label="Last Name" value={lastName} setValue={setLastName} />
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
          <div>
            <label className="mb-2 block text-sm font-medium">Role</label>
            <select
              className="bg-background text-foreground focus:ring-ring w-full rounded border p-2 text-sm focus:ring-2 focus:outline-none"
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
            >
              <option value="ADMIN">Admin</option>
              <option value="FACULTY">Faculty</option>
              <option value="TA">TA</option>
              <option value="STUDENT">Student</option>
            </select>
          </div>
        </div>

        <DialogFooter className="mt-4">
          <DialogClose asChild>
            <Button type="button" variant="secondary">
              Cancel
            </Button>
          </DialogClose>
          <Button type="button" onClick={handleSubmit}>
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
