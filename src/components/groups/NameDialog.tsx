'use client';

import { useEffect, useId, useState } from 'react';
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

/**
 * A minimal single-field name dialog, reused for creating a group and renaming a
 * set or group. The parent supplies the submit handler (which does the API call
 * and toasts); this component owns only the input value, validation, and busy
 * state, and reports success by resolving the promise.
 */
export function NameDialog({
  open,
  setOpen,
  title,
  label,
  description,
  initialValue = '',
  submitLabel = 'Save',
  onSubmit,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
  title: string;
  label: string;
  description?: string;
  initialValue?: string;
  submitLabel?: string;
  onSubmit: (name: string) => Promise<void>;
}) {
  const inputId = useId();
  const errorId = useId();
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Reset to the provided initial value whenever the dialog (re)opens.
  useEffect(() => {
    if (open) {
      setValue(initialValue);
      setError(null);
      setBusy(false);
    }
  }, [open, initialValue]);

  const submit = async () => {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      setError('Name is required');
      return;
    }
    if (trimmed.length > 100) {
      setError('Name is too long (100 characters max).');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit(trimmed);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="bg-card sm:max-w-md" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className={description ? undefined : 'sr-only'}>
            {description ?? title}
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          className="space-y-2"
        >
          <Label htmlFor={inputId}>{label}</Label>
          <Input
            id={inputId}
            value={value}
            autoFocus
            onChange={(e) => setValue(e.target.value)}
            aria-invalid={!!error}
            aria-describedby={error ? errorId : undefined}
            maxLength={120}
          />
          {error && (
            <p id={errorId} role="alert" className="text-xs text-red-600">
              {error}
            </p>
          )}

          <DialogFooter className="pt-2">
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={busy}>
              {busy ? 'Saving…' : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
