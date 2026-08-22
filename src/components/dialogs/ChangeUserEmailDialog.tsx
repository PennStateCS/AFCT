'use client';

import React, { useEffect, useState } from 'react';
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
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { showToast } from '@/lib/toast';
import { apiPaths } from '@/lib/api-paths';
import { apiClient, ApiError } from '@/lib/api/fetch-client';

type Props = {
  open: boolean;
  setOpen: (open: boolean) => void;
  userId: string;
  currentEmail: string;
  userName: string;
  onChanged?: () => void;
};

// Very light client-side shape check; the schema/route are the real validators.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Admin-only change of a user's login email. Warns that it changes their sign-in,
 * and checks availability against /api/auth/check-email (debounced) before enabling
 * Save. The PATCH route re-checks uniqueness, so a race still fails safely with 409.
 */
export function ChangeUserEmailDialog({
  open,
  setOpen,
  userId,
  currentEmail,
  userName,
  onChanged,
}: Props) {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // 'idle' before we've checked; 'checking' while a request is in flight; then the result.
  const [availability, setAvailability] = useState<'idle' | 'checking' | 'available' | 'taken'>(
    'idle',
  );

  const normalized = email.trim().toLowerCase();
  const current = currentEmail.trim().toLowerCase();
  const formatValid = EMAIL_RE.test(normalized);
  const unchanged = normalized === current;

  // Reset to the current email each time the dialog opens for a (possibly different) user.
  useEffect(() => {
    if (open) {
      setEmail(currentEmail);
      setSubmitting(false);
      setAvailability('idle');
    }
  }, [open, currentEmail]);

  // Debounced availability check. Skips when the address is unchanged or malformed.
  useEffect(() => {
    if (!open) return;
    if (!formatValid || unchanged) {
      setAvailability('idle');
      return;
    }
    let cancelled = false;
    setAvailability('checking');
    const t = setTimeout(() => {
      void (async () => {
        try {
          const res = await apiClient.get<{ exists: boolean }>(apiPaths.checkEmail(normalized));
          if (!cancelled) setAvailability(res.exists ? 'taken' : 'available');
        } catch {
          // A failed check shouldn't block submission; the server re-checks on save.
          if (!cancelled) setAvailability('idle');
        }
      })();
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [open, normalized, formatValid, unchanged]);

  const error = !normalized
    ? 'Email is required.'
    : !formatValid
      ? 'Enter a valid email.'
      : unchanged
        ? 'This is already the current email.'
        : availability === 'taken'
          ? 'That email is already in use.'
          : undefined;

  const canSave = !submitting && !error && availability !== 'checking';

  const handleSave = async () => {
    if (!canSave) return;
    setSubmitting(true);
    try {
      await apiClient.patch(apiPaths.user(userId), { email: normalized });
      showToast.updated('Email address');
      onChanged?.();
      setOpen(false);
    } catch (err) {
      showToast.error(err instanceof ApiError ? err.message : 'Failed to change email');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Change Email Address</DialogTitle>
          <DialogDescription>
            Change the login email for {userName}. They will sign in with the new address.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="change-email-input" className="mb-1 block">
            New email
          </Label>
          <Input
            id="change-email-input"
            type="email"
            // Somebody else's address. Left unmarked, the browser offers the admin's own.
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={!!error}
            aria-describedby={error ? 'change-email-error' : undefined}
            placeholder="name@example.edu"
          />
          {error ? (
            <p id="change-email-error" className="text-destructive text-xs" role="alert">
              {error}
            </p>
          ) : availability === 'available' ? (
            <p className="text-muted-foreground text-xs">This email is available.</p>
          ) : availability === 'checking' ? (
            <p className="text-muted-foreground text-xs">Checking availability…</p>
          ) : null}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="ghost">
              Cancel
            </Button>
          </DialogClose>
          <Button type="button" onClick={() => void handleSave()} disabled={!canSave}>
            {submitting ? 'Saving…' : 'Change Email'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
