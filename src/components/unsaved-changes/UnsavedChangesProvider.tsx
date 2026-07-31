'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/**
 * Unsaved-changes protection for the dashboard.
 *
 * A form with pending edits registers itself dirty; while anything is dirty, leaving the page
 * asks first. Two mechanisms, because the browser and the app router are different exits:
 *
 * - `beforeunload` covers refresh, tab close, and typing a new URL. Registered only while dirty:
 *   a permanently registered handler disables the browser's back/forward cache for the whole app.
 *   The browser shows its own generic wording; custom text has been ignored for years.
 * - A capture-phase click listener covers every internal link (sidebar, breadcrumbs, tables,
 *   plain `<Link>`s) without each of them having to know the guard exists. It runs before Next's
 *   own click handler, so preventing default here reliably stops the client-side navigation.
 *   Programmatic navigation (tab switches, the assignment switcher) opts in through
 *   `confirmIfDirty` instead, because it flips component state before any URL change, which a
 *   router-level guard would be too late for.
 *
 * KNOWN LIMIT, stated plainly: browser Back/Forward between client-side routes is NOT guarded.
 * `popstate` cannot be cancelled, the App Router navigates on it, and the workarounds (sentinel
 * history entries, re-pushing the current URL) corrupt Back for every user to protect an edge
 * case. Refresh and close ARE guarded, and Back out of the app entirely triggers `beforeunload`.
 */

type UnsavedChangesContextValue = {
  /** Mark a form dirty or clean. Forms use the hook below rather than calling this directly. */
  setDirty: (id: string, dirty: boolean) => void;
  /**
   * True to proceed. Resolves immediately when nothing is dirty; otherwise asks, once: a second
   * caller while the dialog is open shares the same answer rather than stacking dialogs.
   */
  confirmIfDirty: () => Promise<boolean>;
};

const UnsavedChangesContext = React.createContext<UnsavedChangesContextValue | null>(null);

/** Register a form's dirty state. Unmounting deregisters, so a closed form can never block. */
export function useUnsavedChangesGuard(dirty: boolean) {
  const context = React.useContext(UnsavedChangesContext);
  const id = React.useId();
  const setDirty = context?.setDirty;

  React.useEffect(() => {
    if (!setDirty) return;
    setDirty(id, dirty);
    return () => setDirty(id, false);
  }, [setDirty, id, dirty]);
}

/**
 * The guard for programmatic navigation. Falls back to always-proceed outside the provider, so
 * a component in a test or an unusual mount keeps working unguarded rather than crashing.
 */
export function useConfirmIfDirty(): () => Promise<boolean> {
  const context = React.useContext(UnsavedChangesContext);
  const confirm = context?.confirmIfDirty;
  return React.useMemo(() => confirm ?? (() => Promise.resolve(true)), [confirm]);
}

/** An internal link click the guard should intercept; anything else belongs to the browser. */
function interceptableHref(event: MouseEvent): string | null {
  // Modified clicks (new tab, download) do not leave this page, so they lose nothing.
  if (event.defaultPrevented || event.button !== 0) return null;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
  const anchor = (event.target as Element | null)?.closest?.('a[href]');
  if (!anchor) return null;
  if (anchor.getAttribute('target') === '_blank' || anchor.hasAttribute('download')) return null;
  const href = anchor.getAttribute('href');
  if (!href || href.startsWith('#')) return null;
  const url = new URL(href, window.location.href);
  // External destinations fall through to beforeunload, which is the browser's own guard.
  if (url.origin !== window.location.origin) return null;
  return url.pathname + url.search + url.hash;
}

export function UnsavedChangesProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  // The dirty set lives in a ref (event handlers need the current value without re-subscribing);
  // the boolean mirror is state so effects re-arm when protection starts or stops.
  const dirtyIds = React.useRef(new Set<string>());
  const [anyDirty, setAnyDirty] = React.useState(false);

  const setDirty = React.useCallback((id: string, dirty: boolean) => {
    if (dirty) dirtyIds.current.add(id);
    else dirtyIds.current.delete(id);
    setAnyDirty(dirtyIds.current.size > 0);
  }, []);

  // The open dialog's resolvers. An array, so concurrent askers share one dialog and one answer.
  const pendingResolvers = React.useRef<((proceed: boolean) => void)[]>([]);
  const [dialogOpen, setDialogOpen] = React.useState(false);

  const confirmIfDirty = React.useCallback(() => {
    if (dirtyIds.current.size === 0) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      pendingResolvers.current.push(resolve);
      setDialogOpen(true);
    });
  }, []);

  const settle = React.useCallback((proceed: boolean) => {
    const resolvers = pendingResolvers.current;
    pendingResolvers.current = [];
    setDialogOpen(false);
    for (const resolve of resolvers) resolve(proceed);
  }, []);

  // Browser-level exits. Only while dirty; see the module comment.
  React.useEffect(() => {
    if (!anyDirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Chrome still requires returnValue to be set for the prompt to appear.
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [anyDirty]);

  // In-app link clicks. Capture phase, so this runs before Next's Link handler and before any
  // React onClick, and only exists while something is dirty.
  React.useEffect(() => {
    if (!anyDirty) return;
    const onClick = (event: MouseEvent) => {
      const destination = interceptableHref(event);
      if (destination === null) return;
      event.preventDefault();
      event.stopPropagation();
      void confirmIfDirty().then((proceed) => {
        // Navigate exactly once, and only on an explicit Discard.
        if (proceed) router.push(destination);
      });
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [anyDirty, confirmIfDirty, router]);

  const value = React.useMemo(() => ({ setDirty, confirmIfDirty }), [setDirty, confirmIfDirty]);

  return (
    <UnsavedChangesContext.Provider value={value}>
      {children}
      {/* The confirm. The Dialog primitive already refuses outside-click dismissal, and Escape
          closes it, which lands in onOpenChange(false) = stay: Escape must never discard. */}
      <Dialog open={dialogOpen} onOpenChange={(open) => !open && settle(false)}>
        <DialogContent className="sm:max-w-md" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Discard unsaved changes?</DialogTitle>
            <DialogDescription>
              You have changes that have not been saved. If you leave this page, those changes will
              be lost.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            {/* The safe action carries initial focus, so Enter stays. */}
            <Button type="button" variant="secondary" autoFocus onClick={() => settle(false)}>
              Stay on page
            </Button>
            <Button type="button" variant="destructive" onClick={() => settle(true)}>
              Discard changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </UnsavedChangesContext.Provider>
  );
}

export default UnsavedChangesProvider;
