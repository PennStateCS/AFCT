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
 * Creates a group set. Requires a unique name and optionally seeds a number of
 * empty, default-named groups. The parent selects the new set on success.
 */
export function CreateGroupSetDialog({
  open,
  setOpen,
  courseId,
  onCreated,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
  courseId: string;
  onCreated: (setId: string) => void;
}) {
  const nameId = useId();
  const countId = useId();
  const errorId = useId();
  const [name, setName] = useState('');
  const [count, setCount] = useState('0');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setName('');
      setCount('0');
      setError(null);
      setBusy(false);
    }
  }, [open]);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Name is required');
      return;
    }
    const initialGroupCount = Math.max(0, Math.min(50, Number.parseInt(count, 10) || 0));
    setBusy(true);
    setError(null);
    try {
      const created = await apiClient.post<{ id: string }>(apiPaths.courseGroupSets(courseId), {
        name: trimmed,
        initialGroupCount,
      });
      showToast.success('Group set created');
      setOpen(false);
      onCreated(created.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create group set');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="bg-card sm:max-w-md" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Create Group Set</DialogTitle>
          <DialogDescription className="sr-only">
            Create a new group set in this course.
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
            <Label htmlFor={nameId}>Name</Label>
            <Input
              id={nameId}
              value={name}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Project 1"
              aria-invalid={!!error}
              aria-describedby={error ? errorId : undefined}
              maxLength={120}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor={countId}>Start with this many empty groups (optional)</Label>
            <Input
              id={countId}
              type="number"
              min={0}
              max={50}
              value={count}
              onChange={(e) => setCount(e.target.value)}
              className="w-28"
            />
            <p className="text-muted-foreground text-xs">
              Groups are named Group 1, Group 2, and so on. You can rename or add more later.
            </p>
          </div>

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
              {busy ? 'Creating…' : 'Create group set'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
