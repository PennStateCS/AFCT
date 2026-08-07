'use client';

import * as React from 'react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/**
 * Shortcut hints name both modifiers rather than detecting the platform.
 *
 * Reading `navigator` at module load is wrong in a Next app: the module is evaluated on the
 * server too, where there is no navigator, so the server rendered "Ctrl" while a Mac client
 * hydrated to "Command" and React saw a mismatch. Naming both is deterministic everywhere and
 * still tells a Mac user what to press. Only tooltips and this dialog carry shortcuts; every
 * control's accessible name stays the bare action, so a screen reader gets the verb rather than
 * keyboard trivia.
 */
const MOD_KEY = 'Ctrl/Command';

/**
 * Every shortcut the editor's UI mentions, in one map.
 *
 * The toolbar tooltips and this dialog both read from here, so they cannot disagree. Only
 * shortcuts the toolbar actually surfaces belong in the map: Tiptap binds more (heading levels,
 * list toggles), but documenting keys the UI never mentions is a maintenance promise nobody made.
 */
export const EDITOR_SHORTCUTS = {
  bold: `${MOD_KEY}+B`,
  italic: `${MOD_KEY}+I`,
  underline: `${MOD_KEY}+U`,
  code: `${MOD_KEY}+E`,
  link: `${MOD_KEY}+K`,
  undo: `${MOD_KEY}+Z`,
  redo: `${MOD_KEY}+Shift+Z`,
} as const;

/** Label + keys, in toolbar order. */
const ROWS: { action: string; keys: string }[] = [
  { action: 'Undo', keys: EDITOR_SHORTCUTS.undo },
  { action: 'Redo', keys: EDITOR_SHORTCUTS.redo },
  { action: 'Bold', keys: EDITOR_SHORTCUTS.bold },
  { action: 'Italic', keys: EDITOR_SHORTCUTS.italic },
  { action: 'Underline', keys: EDITOR_SHORTCUTS.underline },
  { action: 'Inline code', keys: EDITOR_SHORTCUTS.code },
  { action: 'Add or edit link', keys: EDITOR_SHORTCUTS.link },
];

/**
 * The keyboard shortcuts, on demand.
 *
 * This exists so the tooltips do not have to be the only place shortcuts are discoverable: they
 * now wait for a deliberate hover, and a reference that requires hovering every button is not a
 * reference. A plain list rather than a table: seven rows do not need sortable columns, and a
 * definition list reads naturally to a screen reader.
 */
export function KeyboardShortcutsDialog({
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
            These work anywhere in the description editor. Formatting can also be applied from the
            toolbar.
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

export default KeyboardShortcutsDialog;
