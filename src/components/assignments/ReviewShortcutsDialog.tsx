'use client';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

/** Label + keys, in the order a grader is likely to reach for them. */
const ROWS: { action: string; keys: string }[] = [
  { action: 'Previous student', keys: '←' },
  { action: 'Next student', keys: '→' },
  { action: 'Jump to a problem', keys: '1 – 9' },
  { action: 'Focus the grade field', keys: 'G' },
];

/**
 * The review page's keyboard shortcuts, on demand.
 *
 * Same reasoning as the editor's: a shortcut nobody can find is a shortcut nobody uses, and
 * a tooltip that waits for a hover is not a reference. A definition list rather than a table,
 * since three rows do not need columns and a list reads naturally aloud.
 */
export function ReviewShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            These work while you are somewhere in the review panel, and not while you are typing in
            a field such as the comment box or a grade.
          </DialogDescription>
        </DialogHeader>
        <dl className="space-y-1.5">
          {ROWS.map(({ action, keys }) => (
            <div key={action} className="flex items-center justify-between gap-4 text-sm">
              <dt>{action}</dt>
              <dd>
                <kbd className="bg-muted rounded border px-1.5 py-0.5 font-mono text-xs">
                  {keys}
                </kbd>
              </dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}

export default ReviewShortcutsDialog;
