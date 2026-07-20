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
import { apiClient, ApiError } from '@/lib/api/fetch-client';
import { apiPaths } from '@/lib/api-paths';
import { showToast } from '@/lib/toast';

/**
 * Duplicates a group set into a new, independent set. The name is prefilled with
 * a non-colliding suggestion. Memberships are copied only when chosen, and only
 * for currently-active students. The parent selects the new set on success.
 */
export function DuplicateGroupSetDialog({
  open,
  setOpen,
  courseId,
  sourceSetId,
  suggestedName,
  onDuplicated,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
  courseId: string;
  sourceSetId: string | null;
  suggestedName: string;
  onDuplicated: (setId: string) => void;
}) {
  const nameId = useId();
  const errorId = useId();
  const [name, setName] = useState(suggestedName);
  const [includeMemberships, setIncludeMemberships] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setName(suggestedName);
      setIncludeMemberships(false);
      setError(null);
      setBusy(false);
    }
  }, [open, suggestedName]);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Name is required');
      return;
    }
    if (!sourceSetId) return;
    setBusy(true);
    setError(null);
    try {
      const created = await apiClient.post<{ id: string }>(
        apiPaths.courseGroupSetDuplicate(courseId, sourceSetId),
        { name: trimmed, includeMemberships },
      );
      showToast.success('Group set duplicated');
      setOpen(false);
      onDuplicated(created.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to duplicate group set');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="bg-card sm:max-w-md" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Duplicate Group Set</DialogTitle>
          <DialogDescription className="sr-only">
            Create an independent copy of this group set.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label htmlFor={nameId}>New set name</Label>
            <Input
              id={nameId}
              value={name}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              aria-invalid={!!error}
              aria-describedby={error ? errorId : undefined}
              maxLength={120}
            />
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">What to copy</legend>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="copyMode"
                className="mt-1"
                checked={!includeMemberships}
                onChange={() => setIncludeMemberships(false)}
              />
              <span>
                Copy groups only
                <span className="text-muted-foreground block text-xs">
                  The new set has the same groups but no students.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="copyMode"
                className="mt-1"
                checked={includeMemberships}
                onChange={() => setIncludeMemberships(true)}
              />
              <span>
                Copy groups and current memberships
                <span className="text-muted-foreground block text-xs">
                  Active students keep their group. Inactive students are not copied.
                </span>
              </span>
            </label>
          </fieldset>

          {error && (
            <p id={errorId} role="alert" className="text-xs text-red-600">
              {error}
            </p>
          )}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={busy}>
              {busy ? 'Duplicating…' : 'Duplicate'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
