'use client';

import * as React from 'react';
import type { Editor } from '@tiptap/react';
import katex from 'katex';
import { describeLatexError, type LatexErrorText } from './latex-error';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Textarea } from '@/components/ui/textarea';
import { KATEX_VALIDATION_OPTIONS, MAX_LATEX_LENGTH } from '@/lib/rich-description';
// Straight from the module, not the barrel: it pulls KaTeX in, which is fine HERE (this dialog
// already renders a live preview with it) but must not travel through the barrel to read-only
// surfaces. See the note in '@/lib/rich-description'.
import { parseLatexSource } from '@/lib/rich-description/latex-parse';
import type { MathClickTarget, MathMode } from './extensions';

export type EquationDialogProps = {
  editor: Editor | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The equation being edited, or null when inserting a new one. */
  target: MathClickTarget | null;
};

const MODE_OPTIONS = [
  { value: 'inline', label: 'Inline' },
  { value: 'block', label: 'Display' },
];

/**
 * Write, edit, or remove a LaTeX equation.
 *
 * Only the LaTeX source is ever stored. The preview here and the rendering in the document both
 * derive their HTML from that source through KaTeX, so nothing generated is persisted.
 *
 * The preview deliberately renders with throwOnError so KaTeX's own message can be shown while
 * typing; the document's node views render with throwOnError off, where a bad expression must
 * degrade rather than break the editor.
 */
export function EquationDialog({ editor, open, onOpenChange, target }: EquationDialogProps) {
  const [latex, setLatex] = React.useState('');
  const [mode, setMode] = React.useState<MathMode>('inline');
  const [error, setError] = React.useState<LatexErrorText | null>(null);
  const previewRef = React.useRef<HTMLDivElement>(null);
  const fieldId = React.useId();
  const errorId = `${fieldId}-error`;
  const previewLabelId = `${fieldId}-preview-label`;
  const isEditing = target !== null;

  /**
   * What assistive tech actually hears, kept separate from what the eye sees.
   *
   * Half-typed LaTeX is invalid LaTeX, so validating on every keystroke means the error text
   * changes constantly while someone types `rac{`. Announcing each of those interrupts a
   * screen-reader user on nearly every key. The visible message still updates immediately; this
   * copy lags behind it and is what the live region reads.
   */
  const [announced, setAnnounced] = React.useState('');
  const lastAnnouncedRef = React.useRef('');

  // Seed from the clicked equation (or reset for a new one) each time the dialog opens.
  React.useEffect(() => {
    if (!open) return;
    setLatex(target?.latex ?? '');
    setMode(target?.mode ?? 'inline');
    setError(null);
  }, [open, target]);

  // Live preview. KaTeX writes into the container itself, so there is no HTML string to hand to
  // dangerouslySetInnerHTML.
  React.useEffect(() => {
    const container = previewRef.current;
    if (!open || !container) return;
    const source = latex.trim();
    if (!source) {
      container.textContent = '';
      setError(null);
      return;
    }
    try {
      katex.render(source, container, {
        ...KATEX_VALIDATION_OPTIONS,
        displayMode: mode === 'block',
      });
      setError(null);
    } catch (cause) {
      container.textContent = '';
      setError(describeLatexError(cause));
    }
  }, [open, latex, mode]);

  // Politely announce the settled error, not every intermediate one. The delay is long enough
  // to cover normal typing and short enough that a user who stops to read is not left waiting.
  React.useEffect(() => {
    if (!open) return;
    const message = error?.message ?? '';
    const timer = setTimeout(() => {
      // Re-announcing an unchanged string is noise: the live region would speak the same
      // sentence again every time the user typed another character that kept it invalid.
      if (message === lastAnnouncedRef.current) return;
      lastAnnouncedRef.current = message;
      setAnnounced(message);
    }, 900);
    return () => clearTimeout(timer);
  }, [error, open]);

  // Reset between openings so a stale message cannot be read out for a different equation.
  React.useEffect(() => {
    if (open) return;
    lastAnnouncedRef.current = '';
    setAnnounced('');
  }, [open]);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!editor) return;
    // An expression KaTeX cannot parse would render as red error text for every student, so it
    // is not saveable. The button is disabled in that state; this guard covers a form submit
    // that arrives another way (Enter in the field).
    // Validate the CURRENT value synchronously. The `error` state is produced by the preview
    // effect, which runs after render, so between changing the source and that effect firing
    // there is a window where `error` still describes the PREVIOUS expression. Trusting it here
    // let a newly invalid equation through: it was non-empty and short enough, so the old
    // length-only check passed and the bad source was written to the document.
    //
    // parseLatexSource re-parses through KaTeX with the same options the published renderer
    // uses, so anything it accepts is something the reader will actually see rendered.
    const result = parseLatexSource(latex);
    if (!result.ok) {
      // Policy messages ("Enter a LaTeX expression.") are already written for the author. Only
      // KaTeX's own wording needs translating.
      const friendly =
        result.kind === 'parse'
          ? describeLatexError(new Error(result.error))
          : { message: result.error };
      setError(friendly);
      // A submission is a deliberate act, so it is announced immediately rather than waiting on
      // the typing debounce.
      lastAnnouncedRef.current = friendly.message;
      setAnnounced(friendly.message);
      return;
    }

    const chain = editor.chain().focus();
    if (target && target.mode === mode) {
      if (mode === 'inline') chain.updateInlineMath({ latex: result.latex, pos: target.pos });
      else chain.updateBlockMath({ latex: result.latex, pos: target.pos });
    } else if (target) {
      // Switching between inline and display means a different node type, and the update
      // commands only rewrite attributes. Remove the old node, then insert the new kind where
      // it stood.
      if (target.mode === 'inline') chain.deleteInlineMath({ pos: target.pos });
      else chain.deleteBlockMath({ pos: target.pos });
      if (mode === 'inline') chain.insertInlineMath({ latex: result.latex, pos: target.pos });
      else chain.insertBlockMath({ latex: result.latex, pos: target.pos });
    } else if (mode === 'inline') {
      chain.insertInlineMath({ latex: result.latex });
    } else {
      chain.insertBlockMath({ latex: result.latex });
    }
    chain.run();
    onOpenChange(false);
  };

  const handleRemove = () => {
    if (!editor || !target) return;
    const chain = editor.chain().focus();
    if (target.mode === 'inline') chain.deleteInlineMath({ pos: target.pos });
    else chain.deleteBlockMath({ pos: target.pos });
    chain.run();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
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
            <DialogTitle>{isEditing ? 'Edit equation' : 'Insert equation'}</DialogTitle>
            {/* The example lives here, in prose, rather than in the field as a placeholder. As a
                placeholder it sat in the same monospace face as real input and authors read it as
                something they had already typed, then could not work out why the preview was
                empty. Outside the field it cannot be mistaken for content. */}
            <DialogDescription>
              Write the equation in LaTeX, for example{' '}
              <code className="font-mono">\frac{'{'}n(n-1){'}'}{'{'}2{'}'}</code>. Inline equations
              sit inside a sentence; display equations stand on their own centered line.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div>
              {/* The group's own aria-label carries the name, so this is a visual heading only. */}
              <span aria-hidden="true" className="mb-2 block text-sm font-medium">
                Placement
              </span>
              <SegmentedControl
                name={`${fieldId}-mode-group`}
                ariaLabel="Placement"
                value={mode}
                onValueChange={(value) => setMode(value as MathMode)}
                options={MODE_OPTIONS}
              />
            </div>

            <div>
              <Label htmlFor={fieldId} className="mb-2 block">
                LaTeX
              </Label>
              <Textarea
                id={fieldId}
                className="font-mono"
                rows={3}
                spellCheck={false}
                autoComplete="off"
                maxLength={MAX_LATEX_LENGTH}
                value={latex}
                onChange={(event) => setLatex(event.target.value)}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? errorId : undefined}
              />
              {/* Visible immediately. This element is NOT the live region: it is referenced by
                  aria-describedby, so the text is available on demand when focus is in the
                  field, without being spoken on every keystroke. */}
              {error && (
                <div id={errorId} className="mt-1 text-xs">
                  <p className="text-destructive">{error.message}</p>
                  {error.detail && (
                    <p className="text-muted-foreground mt-0.5">KaTeX reported: {error.detail}</p>
                  )}
                </div>
              )}
              {/* The announcement channel, polite and debounced. Always in the DOM so the region
                  exists before it has content, which is what makes an update get spoken at all.
                  Only the plain sentence is announced; the raw KaTeX detail is for reading. */}
              <div aria-live="polite" className="sr-only">
                {announced}
              </div>
            </div>

            <div>
              <span
                id={previewLabelId}
                className="text-muted-foreground mb-2 block text-sm font-medium"
              >
                Preview
              </span>
              {/* A named region, so the rendered maths is findable and its purpose is announced
                  rather than being an anonymous box of symbols. KaTeX emits MathML alongside the
                  visual output, so the equation itself stays readable by a screen reader, and
                  this is deliberately NOT a live region: the preview changes on every keystroke,
                  and speaking each intermediate expression would be unusable. A long expression
                  scrolls inside the box rather than widening the dialog. */}
              <div
                role="region"
                aria-labelledby={previewLabelId}
                className="afct-rich-text bg-muted border-input min-h-14 overflow-x-auto rounded-md border px-3 py-2"
              >
                {/* Says why the box is blank, so an empty field beside an empty panel reads as
                    "nothing yet" rather than as a preview that has failed. A sibling of the KaTeX
                    container, not its content: KaTeX owns that element and overwrites it. */}
                {latex.trim() === '' && (
                  <p className="text-muted-foreground text-sm">Your equation will appear here.</p>
                )}
                <div ref={previewRef} />
              </div>
            </div>
          </div>

          <DialogFooter>
            {isEditing && (
              <Button type="button" variant="destructive" onClick={handleRemove}>
                Remove equation
              </Button>
            )}
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            {/* Disabled whenever the current source is known to be unsaveable: an empty or
                whitespace-only field, or one the preview has already rejected. An untouched
                empty field shows no error (nothing has gone wrong yet), but the action is not
                offered either, so the button never invites a click that cannot succeed. */}
            <Button type="submit" disabled={Boolean(error) || latex.trim().length === 0}>
              {isEditing ? 'Update equation' : 'Save equation'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default EquationDialog;
