'use client';

import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type GradeOverrideDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  problemTitle: string;
  maxPoints?: number | null;
  /** The grade currently recorded, used to seed the field. */
  currentGrade: number | null;
  /** Apply the override: set this grade and lock it. */
  onApply: (grade: number) => void | Promise<void>;
  saving?: boolean;
};

/**
 * Enter a grade and hold it against the autograder.
 *
 * A dialog rather than an inline switch because this is a decision with a consequence worth
 * reading: the grade stops moving, including when the student's work is re-run, until
 * somebody removes the override. Staff should meet that sentence before the grade locks,
 * not discover it afterwards.
 */
export function GradeOverrideDialog({
  open,
  onOpenChange,
  problemTitle,
  maxPoints,
  currentGrade,
  onApply,
  saving = false,
}: GradeOverrideDialogProps) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Reseed each time it opens: a stale value from a previous problem would be applied to
  // this one at a single click.
  useEffect(() => {
    if (open) {
      setValue(currentGrade === null ? '' : String(currentGrade));
      setError(null);
    }
  }, [open, currentGrade]);

  const submit = () => {
    const trimmed = value.trim();
    const numeric = trimmed === '' ? NaN : Number(trimmed);
    if (Number.isNaN(numeric)) {
      setError('Enter the grade as a number.');
      return;
    }
    if (numeric < 0) {
      setError('Enter a grade of at least 0.');
      return;
    }
    if (typeof maxPoints === 'number' && numeric > maxPoints) {
      setError(`Enter a grade between 0 and ${maxPoints}.`);
      return;
    }
    setError(null);
    void onApply(numeric);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Override the grade for {problemTitle}</DialogTitle>
          <DialogDescription>
            An overridden grade is locked. It will not change when the autograder runs again,
            and it cannot be edited on the review screen until the override is removed.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <label htmlFor="override-grade" className="text-sm font-medium">
            Grade
          </label>
          <div className="flex items-center gap-2">
            <Input
              id="override-grade"
              type="number"
              inputMode="decimal"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  submit();
                }
              }}
              className="w-24"
              aria-invalid={!!error || undefined}
              aria-describedby={error ? 'override-grade-error' : undefined}
              disabled={saving}
            />
            {typeof maxPoints === 'number' ? (
              <span className="text-muted-foreground text-sm">/{maxPoints}</span>
            ) : null}
          </div>
          {error ? (
            <p id="override-grade-error" role="alert" className="text-destructive text-xs">
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? 'Saving…' : 'Override and lock'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default GradeOverrideDialog;
