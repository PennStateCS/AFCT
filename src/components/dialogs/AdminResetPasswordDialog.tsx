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
  onResetPassword: (newPassword: string) => Promise<void>;
  targetUserName?: string;
};

const passwordValid = (password: string) => {
  return (
    password.length >= 8 && /[A-Z]/.test(password) && /[a-z]/.test(password) && /\d/.test(password)
  );
};

export function AdminResetPasswordDialog({
  open,
  setOpen,
  onResetPassword,
  targetUserName,
}: Props) {
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  useEffect(() => {
    if (!open) {
      setNewPassword('');
      setConfirmNewPassword('');
      setLoading(false);
      setShowNew(false);
      setShowConfirm(false);
    }
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPassword || !confirmNewPassword) {
      toast.error('Please fill in all fields');
      return;
    }
    if (!passwordValid(newPassword)) {
      toast.error('New password does not meet the requirements');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      toast.error("Passwords don't match");
      return;
    }

    setLoading(true);
    try {
      await onResetPassword(newPassword);
      toast.success('Password reset successfully!');
      setOpen(false);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to reset password';
      toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="bg-card">
        <DialogHeader>
          <DialogTitle>Reset Password</DialogTitle>
          <DialogDescription>
            {targetUserName
              ? `Set a new password for ${targetUserName}.`
              : 'Set a new password for this user.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
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
              {loading ? 'Saving...' : 'Reset Password'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
