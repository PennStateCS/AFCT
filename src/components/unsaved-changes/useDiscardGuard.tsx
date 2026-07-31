'use client';

import * as React from 'react';

import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';
import { useUnsavedChangesGuard } from './UnsavedChangesProvider';

/**
 * Discard protection for a dialog-hosted form.
 *
 * A modal form loses its edits two ways, and the page-level guard only covers one of them. While
 * the modal is open its overlay blocks every link and tab behind it, so the only page-level exits
 * left are refresh and tab close; registering `dirty` here covers those through the provider's
 * `beforeunload`. The loss path that actually bites in a modal is the DIALOG closing: Escape or
 * the X throws away a half-built problem with nothing to catch it. `requestClose` is that catch.
 *
 * Wire it into the dialog's `onOpenChange` close path only. Successful saves should keep calling
 * `setOpen(false)` directly: that bypasses `onOpenChange`, which is exactly right, because a
 * completed save has nothing left to discard and must never be challenged.
 */
export function useDiscardGuard({
  dirty,
  onDiscard,
}: {
  /** Current value-comparison dirtiness of the form (gate it on the dialog being open). */
  dirty: boolean;
  /** Actually close: setOpen(false) plus the dialog's own reset. Runs only when safe or confirmed. */
  onDiscard: () => void;
}) {
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  useUnsavedChangesGuard(dirty);

  const onDiscardRef = React.useRef(onDiscard);
  React.useEffect(() => {
    onDiscardRef.current = onDiscard;
  }, [onDiscard]);

  const requestClose = React.useCallback(() => {
    if (dirty) setConfirmOpen(true);
    else onDiscardRef.current();
  }, [dirty]);

  const discardConfirm = (
    <ConfirmDialog
      open={confirmOpen}
      variant="destructive"
      title="Discard unsaved changes?"
      description="You have changes that have not been saved. If you close this dialog, those changes will be lost."
      confirmText="Discard changes"
      cancelText="Keep editing"
      onConfirm={() => {
        setConfirmOpen(false);
        onDiscardRef.current();
      }}
      // Cancel, Escape, or any dismissal of the confirm all mean keep editing.
      onCancel={() => setConfirmOpen(false)}
    />
  );

  return { requestClose, discardConfirm };
}

export default useDiscardGuard;
