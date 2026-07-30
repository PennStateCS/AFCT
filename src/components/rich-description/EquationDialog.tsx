'use client';

import * as React from 'react';
import type { Editor } from '@tiptap/react';
import katex from 'katex';

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
import { MAX_LATEX_LENGTH, validateLatex } from '@/lib/rich-description';
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
  const [error, setError] = React.useState<string | null>(null);
  const previewRef = React.useRef<HTMLDivElement>(null);
  const fieldId = React.useId();
  const errorId = `${fieldId}-error`;
  const isEditing = target !== null;

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
        throwOnError: true,
        output: 'htmlAndMathml',
        trust: false,
        strict: 'ignore',
        maxSize: 20,
        maxExpand: 200,
        displayMode: mode === 'block',
      });
      setError(null);
    } catch (cause) {
      container.textContent = '';
      setError(cause instanceof Error ? cause.message : 'This is not valid LaTeX.');
    }
  }, [open, latex, mode]);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!editor) return;
    // An expression KaTeX cannot parse would render as red error text for every student, so it
    // is not saveable. The button is disabled in that state; this guard covers a form submit
    // that arrives another way (Enter in the field).
    if (error) return;
    const result = validateLatex(latex);
    if (!result.ok) {
      setError(result.error);
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
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{isEditing ? 'Edit equation' : 'Insert equation'}</DialogTitle>
            <DialogDescription>
              Write the equation in LaTeX. Inline equations sit inside a sentence; display
              equations stand on their own centered line.
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
                placeholder="\frac{n(n-1)}{2}"
                value={latex}
                onChange={(event) => setLatex(event.target.value)}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? errorId : undefined}
              />
              {error && (
                <p id={errorId} role="alert" className="text-destructive mt-1 text-xs">
                  {error}
                </p>
              )}
            </div>

            <div>
              <span className="text-muted-foreground mb-2 block text-sm font-medium">Preview</span>
              {/* KaTeX emits MathML alongside the visual output, so the preview is readable by a
                  screen reader. A long expression scrolls inside this box rather than widening
                  the dialog. */}
              <div
                ref={previewRef}
                className="afct-rich-text bg-muted/30 border-input min-h-14 overflow-x-auto rounded-md border px-3 py-2"
              />
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
            <Button type="submit" disabled={Boolean(error)}>
              {isEditing ? 'Update equation' : 'Save equation'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default EquationDialog;
