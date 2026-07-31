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

  /**
   * Where the author was when the confirm interrupted them.
   *
   * A dialog normally restores focus on its own, to whatever was active when it opened. That is
   * no help here: the confirm is raised from the HOST dialog's Escape handling, which has already
   * moved focus off the field, so what gets restored is the document body. The author chooses
   * "Keep editing", the form is still open in front of them, and their focus is at the top of the
   * page: they have to tab all the way back in to reach the field they were in.
   */
  const returnFocusRef = React.useRef<HTMLElement | null>(null);

  const requestClose = React.useCallback(() => {
    if (dirty) {
      const active = document.activeElement;
      returnFocusRef.current = active instanceof HTMLElement ? active : null;
      setConfirmOpen(true);
    } else onDiscardRef.current();
  }, [dirty]);

  // Keep editing means carry on where you were, so put focus back. After a frame, so it lands
  // after the confirm's own restore rather than being overwritten by it, and only if the element
  // is still in the document (the host dialog can re-render between the two).
  const keepEditing = React.useCallback(() => {
    setConfirmOpen(false);
    const target = returnFocusRef.current;
    returnFocusRef.current = null;
    if (!target || !target.isConnected) return;
    requestAnimationFrame(() => {
      if (target.isConnected) target.focus();
    });
  }, []);

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
        returnFocusRef.current = null;
        onDiscardRef.current();
      }}
      // Cancel, Escape, or any dismissal of the confirm all mean keep editing.
      onCancel={keepEditing}
    />
  );

  return { requestClose, discardConfirm };
}

export default useDiscardGuard;
