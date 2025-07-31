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
import InputGroup from '@/components/ui/InputGroup';
import { useState, useEffect } from 'react';
import { toast } from 'sonner';

type Props = {
  open: boolean;
  setOpen: (open: boolean) => void;
  onChangePassword: (oldPassword: string, newPassword: string) => Promise<void>;
};

const passwordValid = (password: string) => {
  return (
    password.length >= 8 && /[A-Z]/.test(password) && /[a-z]/.test(password) && /\d/.test(password)
  );
};

export function ChangePasswordDialog({ open, setOpen, onChangePassword }: Props) {
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const [showOld, setShowOld] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  useEffect(() => {
    if (!open) {
      setOldPassword('');
      setNewPassword('');
      setConfirmNewPassword('');
      setLoading(false);
      setShowOld(false);
      setShowNew(false);
      setShowConfirm(false);
    }
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!oldPassword || !newPassword || !confirmNewPassword) {
      toast.error('Please fill in all fields');
      return;
    }
    if (!passwordValid(newPassword)) {
      toast.error('New password does not meet the requirements');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      toast.error("New passwords don't match!");
      return;
    }

    setLoading(true);
    try {
      await onChangePassword(oldPassword, newPassword);
      toast.success('Password changed successfully!');
      setOpen(false);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to change password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change Password</DialogTitle>
          <DialogDescription>Enter your old password and choose a new one.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <InputGroup
            label="Old Password"
            value={oldPassword}
            setValue={setOldPassword}
            type={showOld ? 'text' : 'password'}
            showEye
            isPasswordVisible={showOld}
            togglePasswordVisibility={() => setShowOld((v) => !v)}
          />
          <InputGroup
            label="New Password"
            value={newPassword}
            setValue={setNewPassword}
            type={showNew ? 'text' : 'password'}
            showEye
            isPasswordVisible={showNew}
            togglePasswordVisibility={() => setShowNew((v) => !v)}
            showStatus
            isValid={passwordValid(newPassword)}
          />
          <InputGroup
            label="Confirm New Password"
            value={confirmNewPassword}
            setValue={setConfirmNewPassword}
            type={showConfirm ? 'text' : 'password'}
            showEye
            isPasswordVisible={showConfirm}
            togglePasswordVisibility={() => setShowConfirm((v) => !v)}
            showStatus
            isValid={confirmNewPassword.length > 0 && confirmNewPassword === newPassword}
          />
          <DialogFooter className="mt-2">
            <Button
              variant="secondary"
              type="button"
              onClick={() => setOpen(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
