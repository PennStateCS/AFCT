'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { showToast } from '@/lib/toast';

type Change =
  | {
      kind: 'add';
      member: { email: string | null; firstName: string | null; lastName: string | null };
      role: string;
    }
  | { kind: 'drop'; userId: string; name: string; role: string }
  | { kind: 'restore'; userId: string; name: string }
  | { kind: 'link-identity'; userId: string; name: string; ltiUserId: string };

type Diff = {
  changes: Change[];
  keptStaff: { name: string; role: string }[];
  unchanged: number;
};

/** What each change means, in words. Never conveyed by colour alone. */
const WHAT_HAPPENS: Record<Change['kind'], string> = {
  add: 'Will be added',
  drop: 'Will be marked dropped',
  restore: 'Will be re-enrolled',
  'link-identity': 'Grades can be sent once connected',
};

const nameOf = (change: Change) =>
  change.kind === 'add'
    ? `${change.member.firstName ?? ''} ${change.member.lastName ?? ''}`.trim() ||
      change.member.email ||
      'Somebody with no name'
    : change.name;

/**
 * Reads the LMS roster, shows what applying it would do, and applies it on confirmation.
 *
 * This decides who can read student work, so it never happens on a timer and never without
 * somebody seeing the list first.
 */
export function RosterSyncDialog({
  courseId,
  open,
  onOpenChange,
  onApplied,
}: {
  courseId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApplied?: () => void;
}) {
  const [diff, setDiff] = useState<Diff | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  const load = useCallback(async () => {
    setDiff(null);
    setError(null);
    try {
      const res = await fetch(`/api/courses/${courseId}/roster-sync`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError((body as { error?: string }).error ?? 'Could not read the roster from your LMS.');
        return;
      }
      setDiff(body as Diff);
    } catch {
      setError('Could not read the roster from your LMS.');
    }
  }, [courseId]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const apply = async () => {
    setApplying(true);
    try {
      const res = await fetch(`/api/courses/${courseId}/roster-sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        added?: number;
        dropped?: number;
        error?: string;
      };
      if (!res.ok) {
        showToast.error(
          body.error ?? 'Could not sync the roster. Check your connection and try again.',
        );
        return;
      }
      // Counts go in the description: the headline says what happened, the detail says how much.
      showToast.success('Roster synced', {
        description: `${body.added ?? 0} added, ${body.dropped ?? 0} marked dropped.`,
      });
      onOpenChange(false);
      onApplied?.();
    } catch {
      showToast.error('Could not sync the roster. Check your connection and try again.');
    } finally {
      setApplying(false);
    }
  };

  const nothingToDo = diff !== null && diff.changes.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Sync roster from your LMS</DialogTitle>
          <DialogDescription>Nothing changes until you choose to apply it.</DialogDescription>
        </DialogHeader>

        {/* Focusable so it can be scrolled by keyboard, and named so that focus stop means
            something when announced. */}
        <div
          className="max-h-96 overflow-y-auto"
          tabIndex={0}
          role="group"
          aria-label="Roster changes"
        >
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}

          {!error && diff === null && (
            <p className="text-muted-foreground text-sm">Reading your LMS...</p>
          )}

          {nothingToDo && (
            <p className="text-muted-foreground text-sm">
              Your LMS roster already matches this course. Nothing to change.
            </p>
          )}

          {diff && diff.changes.length > 0 && (
            <ul className="divide-y rounded-md border">
              {diff.changes.map((change, index) => (
                <li key={`${change.kind}-${index}`} className="flex flex-col gap-0.5 p-3">
                  <span className="text-sm font-medium">{nameOf(change)}</span>
                  <span className="text-muted-foreground text-xs">{WHAT_HAPPENS[change.kind]}</span>
                </li>
              ))}
            </ul>
          )}

          {diff && diff.keptStaff.length > 0 && (
            <div className="mt-4">
              <h3 className="text-sm font-medium">Kept as they are</h3>
              <p className="text-muted-foreground mt-1 text-xs">
                Your LMS does not list these people, but they run this course in AFCT, so they are
                left alone.
              </p>
              <ul className="text-muted-foreground mt-2 text-xs">
                {diff.keptStaff.map((person) => (
                  <li key={person.name}>
                    {person.name}, {person.role === 'FACULTY' ? 'faculty' : 'teaching assistant'}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {diff && diff.unchanged > 0 && (
            <p className="text-muted-foreground mt-4 text-xs">
              {diff.unchanged} {diff.unchanged === 1 ? 'person is' : 'people are'} already correct.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={applying}>
            Cancel
          </Button>
          <Button onClick={() => void apply()} disabled={applying || nothingToDo || diff === null}>
            {applying ? 'Applying...' : 'Apply these changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
