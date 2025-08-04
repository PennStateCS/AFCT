'use client';

import { useState } from 'react';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import InputGroup from '@/components/ui/InputGroup';
import { toast } from 'sonner';

// Password validation rules
const passwordRules = [
  { label: 'At least 8 characters', test: (pw: string) => pw.length >= 8 },
  { label: 'One uppercase letter', test: (pw: string) => /[A-Z]/.test(pw) },
  { label: 'One lowercase letter', test: (pw: string) => /[a-z]/.test(pw) },
  { label: 'One number', test: (pw: string) => /\d/.test(pw) },
  { label: 'One special character', test: (pw: string) => /[^A-Za-z0-9]/.test(pw) },
];
const isStrongPassword = (pw: string) => passwordRules.every((rule) => rule.test(pw));

type CreateUserDialogProps = {
  open: boolean;
  setOpen: (open: boolean) => void;
  onSuccess?: () => void;
};

export function CreateUserDialog({ open, setOpen, onSuccess }: CreateUserDialogProps) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [role, setRole] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!firstName || !lastName || !email || !password || !confirmPassword || !role) {
      toast.error('Please fill out all fields.');
      return;
    }

    if (!isStrongPassword(password)) {
      toast.error('Password does not meet the requirements.');
      return;
    }

    if (password !== confirmPassword) {
      toast.error('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    const res = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ firstName, lastName, email, password, role }),
    });

    if (res.ok) {
      toast.success('User created');
      onSuccess?.();
      setOpen(false);
    } else {
      const message = await res.text();
      toast.error(message || 'Failed to create user');
    }
    setSubmitting(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create New User</DialogTitle>
          <DialogDescription>Fill out the fields to create a user account.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <InputGroup label="First Name" value={firstName} setValue={setFirstName} />
          <InputGroup label="Last Name" value={lastName} setValue={setLastName} />
          <InputGroup label="Email" value={email} setValue={setEmail} type="email" />
          <InputGroup
            label="Password"
            value={password}
            setValue={setPassword}
            type={showPassword ? 'text' : 'password'}
            showEye
            isPasswordVisible={showPassword}
            togglePasswordVisibility={() => setShowPassword((v) => !v)}
            showStatus
            isValid={password.length > 0 && isStrongPassword(password)}
          />
          <InputGroup
            label="Confirm Password"
            value={confirmPassword}
            setValue={setConfirmPassword}
            type={showConfirm ? 'text' : 'password'}
            showEye
            isPasswordVisible={showConfirm}
            togglePasswordVisibility={() => setShowConfirm((v) => !v)}
            showStatus
            isValid={confirmPassword.length > 0 && confirmPassword === password}
          />

          <div>
            <label className="mb-2 block text-sm font-medium">Role</label>
            <Select onValueChange={setRole} value={role}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select a role" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ADMIN">Admin</SelectItem>
                <SelectItem value="FACULTY">Faculty</SelectItem>
                <SelectItem value="TA">TA</SelectItem>
                <SelectItem value="STUDENT">Student</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="text-muted-foreground pt-1 text-sm">
            Password must include:
            <ul className="ml-4 list-disc">
              {passwordRules.map((rule) => {
                const passed = rule.test(password);
                return (
                  <li key={rule.label} className={passed ? 'text-green-600' : 'text-red-500'}>
                    {rule.label}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>

        <DialogFooter className="bg-card mt-4">
          <DialogClose asChild>
            <Button variant="secondary" type="button">
              Cancel
            </Button>
          </DialogClose>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? 'Creating...' : 'Create User'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
