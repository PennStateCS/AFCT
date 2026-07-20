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
import SwitchField from '@/components/ui/SwitchField';
import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { PasswordRulesHelper } from '@/components/auth/PasswordRulesHelper';
import { isStrongPassword, passwordRules } from '@/lib/password-policy';
import { ResetPasswordSchema } from '@/schemas/password';

type Props = {
  open: boolean;
  setOpen: (open: boolean) => void;
  onResetPassword: (newPassword: string, isTemporary: boolean) => Promise<void>;
  targetUserName?: string;
};

export function ResetPasswordDialog({
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
  const [isTemporary, setIsTemporary] = useState(false);
  const passwordHelperId = 'admin-reset-password-helper';
  const passwordRuleStatuses = passwordRules.map((rule) => ({
    label: rule.label,
    passed: rule.test(newPassword),
  }));

  useEffect(() => {
    if (!open) {
      setNewPassword('');
      setConfirmNewPassword('');
      setLoading(false);
      setShowNew(false);
      setShowConfirm(false);
      setIsTemporary(false);
    }
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const parsed = ResetPasswordSchema.safeParse({ newPassword, confirmNewPassword });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? 'Please review the password fields.');
      return;
    }

    setLoading(true);
    try {
      await onResetPassword(parsed.data.newPassword, isTemporary);
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
      <DialogContent
        className="bg-card"
        onInteractOutside={(e) => e.preventDefault()}
      >
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
            name="newPassword"
            label="New Password"
            value={newPassword}
            setValue={setNewPassword}
            type={showNew ? 'text' : 'password'}
            showEye
            isPasswordVisible={showNew}
            togglePasswordVisibility={() => setShowNew((v) => !v)}
            showStatus
            isValid={isStrongPassword(newPassword)}
            additionalDescribedBy={passwordHelperId}
          />
          <InputGroup
            name="confirmNewPassword"
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
          <PasswordRulesHelper id={passwordHelperId} rules={passwordRuleStatuses} />
          <SwitchField
            label="Temporary password"
            name="temporaryPassword"
            checked={isTemporary}
            onCheckedChange={setIsTemporary}
            description="Require the user to change this password at their next login."
            descriptionPlacement="inline"
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
