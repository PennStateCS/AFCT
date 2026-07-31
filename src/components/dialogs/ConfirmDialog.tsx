'use client';

import * as React from 'react';
import { Loader2 } from 'lucide-react';
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

/**
 * Shared confirmation dialog for actions that need a deliberate "yes" before they run.
 *
 * Use it when an action is hard to reverse, removes someone's access, affects other
 * users, or permanently deletes data. Do NOT use it for routine, easily reversible
 * actions (saving a form, enrolling a user, moving a group member): an extra click there
 * is just friction.
 *
 * Give every dialog a clear title, a one-sentence description of the consequence, and a
 * specific `confirmText` that names the action ("Delete course", "Drop student"). Reserve
 * `variant="destructive"` (the red button) for genuinely permanent or access-removing
 * actions; leave it at the default for reversible ones so the UI is not needlessly alarming.
 *
 * Busy handling: if `onConfirm` returns a Promise, the dialog disables both buttons and
 * shows a spinner while it resolves, so a double-click cannot fire the action twice. Call
 * sites that already track their own pending flag can pass `busy` instead (or as well).
 *
 * @example Destructive delete, letting the dialog manage the busy state
 * ```tsx
 * <ConfirmDialog
 *   open={open}
 *   variant="destructive"
 *   title="Delete course?"
 *   description="This permanently removes the course and all of its data."
 *   confirmText="Delete course"
 *   onConfirm={() => deleteCourse(id)} // returns a Promise -> spinner + double-click guard
 *   onCancel={() => setOpen(false)}
 * />
 * ```
 *
 * @example Reversible action with an externally tracked busy flag
 * ```tsx
 * <ConfirmDialog
 *   open={open}
 *   title="Unpublish assignment?"
 *   description="Students will no longer see this assignment."
 *   confirmText="Unpublish"
 *   busy={saving}
 *   onConfirm={handleUnpublish}
 *   onCancel={() => setOpen(false)}
 * />
 * ```
 *
 * @example Type-to-confirm for a high-stakes action
 * ```tsx
 * <ConfirmDialog
 *   open={open}
 *   variant="destructive"
 *   title="Restore this version?"
 *   description="This discards every record created since the backup."
 *   confirmText="Restore version"
 *   requireTypedConfirmation={targetVersion}
 *   typedConfirmationLabel={`Type ${targetVersion} to confirm.`}
 *   onConfirm={() => downgrade(targetVersion)}
 *   onCancel={() => setOpen(false)}
 * />
 * ```
 */
export interface ConfirmDialogProps {
  /** Whether the dialog is visible. */
  open: boolean;
  /** Short, specific title, e.g. "Delete course?". */
  title?: string;
  /** One sentence describing what happens if the user confirms. */
  description?: React.ReactNode;
  /** Action-specific confirm label, e.g. "Delete course". */
  confirmText?: string;
  /** Cancel label. Defaults to "Cancel". */
  cancelText?: string;
  /** Button styling. Use "destructive" only for permanent or access-removing actions. */
  variant?: 'default' | 'destructive';
  /**
   * Externally tracked pending flag. When true the buttons are disabled and the confirm
   * button shows a spinner. Combines with the internal pending state, so passing it is
   * optional when `onConfirm` returns a Promise.
   */
  busy?: boolean;
  /**
   * When set, the confirm button stays disabled until the user types this exact string
   * into a text field. Use for the most consequential actions (for example a version
   * downgrade that discards data).
   */
  requireTypedConfirmation?: string;
  /** Help text shown above the type-to-confirm field. Also used as its accessible name. */
  typedConfirmationLabel?: React.ReactNode;
  /**
   * Runs when the user confirms. If it returns a Promise, the dialog manages a busy state
   * while it resolves and blocks repeat submissions.
   */
  onConfirm: () => void | Promise<void>;
  /** Runs when the user cancels, presses Escape, or dismisses the dialog. */
  onCancel: () => void;
  /**
   * Passed through to the underlying dialog. Use it to redirect focus on close when the
   * control that opened the dialog has since become disabled (for example while a
   * long-running action runs in a separate progress panel).
   */
  onCloseAutoFocus?: (event: Event) => void;
}

export function ConfirmDialog({
  open,
  title = 'Are you sure?',
  description = 'This action cannot be undone.',
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'default',
  busy = false,
  requireTypedConfirmation,
  typedConfirmationLabel,
  onConfirm,
  onCancel,
  onCloseAutoFocus,
}: ConfirmDialogProps) {
  const [internalPending, setInternalPending] = React.useState(false);
  const [typed, setTyped] = React.useState('');

  const cancelRef = React.useRef<HTMLButtonElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  // Guards against setting state after the dialog unmounts (a caller often closes it on
  // success while the confirm promise is still settling).
  const mountedRef = React.useRef(true);
  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Reset the typed value each time the dialog closes so a reopen starts clean.
  React.useEffect(() => {
    if (!open) setTyped('');
  }, [open]);

  const pending = busy || internalPending;
  const typedSatisfied = !requireTypedConfirmation || typed.trim() === requireTypedConfirmation;

  async function handleConfirm() {
    // Prevent repeated submissions and enforce the typed gate even if a caller wires the
    // button up in an unusual way.
    if (pending || !typedSatisfied) return;
    const result = onConfirm();
    if (result && typeof (result as Promise<void>).then === 'function') {
      try {
        setInternalPending(true);
        await result;
      } finally {
        if (mountedRef.current) setInternalPending(false);
      }
    }
  }

  function handleOpenChange(next: boolean) {
    // Never let an in-flight action be dismissed out from under itself.
    if (pending) return;
    if (!next) onCancel();
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        // No close "X": Cancel and Escape are the two clear ways out of a confirmation.
        showCloseButton={false}
        onEscapeKeyDown={(event) => {
          if (pending) event.preventDefault();
        }}
        onOpenAutoFocus={(event) => {
          // Focus the safe control by default (Cancel), or the typed field when present,
          // rather than letting focus land on the confirm button.
          event.preventDefault();
          (requireTypedConfirmation ? inputRef.current : cancelRef.current)?.focus();
        }}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {requireTypedConfirmation && (
          <div className="grid gap-2">
            {typedConfirmationLabel && (
              <p className="text-muted-foreground text-sm">{typedConfirmationLabel}</p>
            )}
            <Input
              ref={inputRef}
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              disabled={pending}
              autoComplete="off"
              aria-label={
                typeof typedConfirmationLabel === 'string'
                  ? typedConfirmationLabel
                  : `Type ${requireTypedConfirmation} to confirm`
              }
              onKeyDown={(event) => {
                if (event.key === 'Enter' && typedSatisfied && !pending) {
                  event.preventDefault();
                  void handleConfirm();
                }
              }}
            />
          </div>
        )}

        <DialogFooter className="flex gap-2">
          <Button ref={cancelRef} variant="secondary" onClick={onCancel} disabled={pending}>
            {cancelText}
          </Button>
          <Button
            variant={variant}
            onClick={() => void handleConfirm()}
            disabled={pending || !typedSatisfied}
          >
            {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
            {confirmText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
