'use client';

import * as React from 'react';
import type { Editor } from '@tiptap/react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { validateLinkUrl } from '@/lib/rich-description';

export type LinkDialogProps = {
  editor: Editor | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * Add, edit, or remove a link. The URL goes through the shared validator, so only https: and
 * mailto: are accepted and the faculty member gets a specific message otherwise.
 *
 * The editor's selection is captured when the dialog opens and restored before any command
 * runs: focusing the dialog input collapses the document selection, so applying the mark to
 * "the text they had selected" requires putting that range back first.
 */
export function LinkDialog({ editor, open, onOpenChange }: LinkDialogProps) {
  const [url, setUrl] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  // The document range the link applies to, captured at open time.
  const savedRange = React.useRef<{ from: number; to: number } | null>(null);
  const inputId = React.useId();
  const errorId = `${inputId}-error`;

  const existingHref = editor?.getAttributes('link')?.href as string | undefined;
  const isEditing = Boolean(existingHref);

  // The selected text, shown so the author can confirm what will become the link.
  const selectedText = React.useMemo(() => {
    if (!editor || !open) return '';
    const { from, to } = editor.state.selection;
    return editor.state.doc.textBetween(from, to, ' ');
  }, [editor, open]);

  // Seed the field from the existing link (if any) each time the dialog opens, and remember
  // the range before focus moves into the input.
  React.useEffect(() => {
    if (!open || !editor) return;
    const { from, to } = editor.state.selection;
    savedRange.current = { from, to };
    setUrl(existingHref ?? '');
    setError(null);
    // existingHref is read at open time on purpose; it must not re-seed while typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editor]);

  const withSavedSelection = (run: (chain: ReturnType<Editor['chain']>) => void) => {
    if (!editor) return;
    const chain = editor.chain().focus();
    const range = savedRange.current;
    if (range) chain.setTextSelection(range);
    run(chain);
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const result = validateLinkUrl(url);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    withSavedSelection((chain) => {
      // An empty selection would drop the mark on nothing, so insert the URL as its own text
      // and link that instead.
      const range = savedRange.current;
      if (range && range.from === range.to) {
        chain
          .insertContent(result.href)
          .setTextSelection({ from: range.from, to: range.from + result.href.length })
          .setLink({ href: result.href })
          .run();
      } else {
        chain.setLink({ href: result.href }).run();
      }
    });
    onOpenChange(false);
  };

  const handleRemove = () => {
    withSavedSelection((chain) => chain.unsetLink().run());
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* bg-card for the same reason as the equation dialog: the DialogContent default is
          the page background, not an elevated surface. */}
      <DialogContent className="sm:max-w-md">
        {/* stopPropagation, not just preventDefault: Radix portals this dialog out of the
            surrounding DOM, but React's synthetic events still travel the REACT tree, so a submit
            here reached the enclosing form. Committing an equation was silently saving the whole
            assignment. */}
        <form
          onSubmit={(event) => {
            event.stopPropagation();
            handleSubmit(event);
          }}
        >
          <DialogHeader>
            <DialogTitle>{isEditing ? 'Edit link' : 'Add link'}</DialogTitle>
            <DialogDescription>
              Web addresses must start with https://. Use mailto: for an email address.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {selectedText && (
              <p className="text-muted-foreground text-sm">
                Link text: <span className="text-foreground font-medium">{selectedText}</span>
              </p>
            )}
            <div>
              <Label htmlFor={inputId} className="mb-2 block">
                Web address
              </Label>
              <Input
                id={inputId}
                // Not type="url": the browser's own validation message is vaguer than ours and
                // would reject mailto: inconsistently across browsers.
                type="text"
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                placeholder="https://example.edu"
                value={url}
                onChange={(event) => {
                  setUrl(event.target.value);
                  setError(null);
                }}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? errorId : undefined}
              />
              {error && (
                <p id={errorId} role="alert" className="text-destructive mt-1 text-xs">
                  {error}
                </p>
              )}
            </div>
          </div>

          <DialogFooter>
            {isEditing && (
              <Button type="button" variant="destructive" onClick={handleRemove}>
                Remove link
              </Button>
            )}
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            {/* "Save link" rather than "Add link": the toolbar button that opens this dialog is
                already named "Add link", and two identically-named controls on screen is
                ambiguous for screen-reader and voice-control users. */}
            <Button type="submit">{isEditing ? 'Update link' : 'Save link'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default LinkDialog;
