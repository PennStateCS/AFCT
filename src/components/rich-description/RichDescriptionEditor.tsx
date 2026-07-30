'use client';

import * as React from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  RICH_DESCRIPTION_VERSION,
  plainTextToRichDescription,
  validateRichDescription,
  type RichDescriptionEnvelope,
} from '@/lib/rich-description';
import { createRichDescriptionExtensions, type MathClickTarget } from './extensions';
import { RichDescriptionToolbar } from './RichDescriptionToolbar';
import { LinkDialog } from './LinkDialog';
import { EquationDialog } from './EquationDialog';

/**
 * A minimal handle onto the live editor. Deliberately narrow: callers drive the document
 * through named operations rather than reaching for the Tiptap instance, so the toolbar and
 * tests share one seam and the component keeps ownership of the editor.
 */
export type RichDescriptionEditorHandle = {
  insertText: (text: string) => void;
  /** Select the whole document (what a real Ctrl+A does; jsdom cannot drive that). */
  selectAll: () => void;
  isEmpty: () => boolean;
};

export type RichDescriptionEditorProps = {
  /**
   * Current value. Accepts a versioned envelope, or a plain string for a legacy record (it is
   * converted through the shared utility). Treated as the INITIAL document only: this is not a
   * controlled input, so later prop changes do not reset the editor mid-edit (that would fight
   * the user's cursor). Remount with a new `key` to load a different record.
   */
  value?: RichDescriptionEnvelope | string | null;
  /** Emits the updated versioned envelope on every document change. */
  onChange?: (value: RichDescriptionEnvelope) => void;
  onBlur?: () => void;
  /** Called once the editor exists, with a handle for programmatic edits. */
  onReady?: (handle: RichDescriptionEditorHandle) => void;
  /** Non-editable and visibly muted. */
  disabled?: boolean;
  /** Non-editable but not styled as disabled (e.g. a read-only viewer). */
  readOnly?: boolean;
  placeholder?: string;
  /** Render the formatting toolbar above the document. */
  showToolbar?: boolean;
  /** Accessible name for the toolbar itself (defaults to "Formatting"). */
  toolbarLabel?: string;
  /** Wired to aria-labelledby / aria-describedby by the caller's field wrapper. */
  ariaLabel?: string;
  ariaLabelledBy?: string;
  ariaDescribedBy?: string;
  /** Marks the editor invalid for assistive tech and turns on the destructive ring. */
  invalid?: boolean;
  /**
   * Offer the expanded (full-viewport) editing mode. On by default when the toolbar is shown;
   * pass false for a surface where an overlay would be wrong.
   */
  allowExpand?: boolean;
  /** Shown as the expanded view's heading, so the author knows what they are editing. */
  expandedTitle?: string;
  className?: string;
  /** Tailwind min-height class for the editable area. */
  minHeightClassName?: string;
};

/** Normalize the incoming value to a Tiptap document for the editor's initial content. */
function toInitialContent(value: RichDescriptionEditorProps['value']) {
  if (typeof value === 'string') return plainTextToRichDescription(value).document;
  if (value && typeof value === 'object') {
    const result = validateRichDescription(value);
    // Unsupported/malformed JSON falls back to an empty document rather than throwing in
    // render; the stored plain text remains the source of truth until the user saves.
    if (result.ok) return result.envelope.document;
  }
  return plainTextToRichDescription('').document;
}

/**
 * The shared rich-description editor. Owns one Tiptap instance and emits versioned envelopes;
 * it holds no second copy of the document (Tiptap's state is the single source of truth).
 */
export function RichDescriptionEditor({
  value,
  onChange,
  onBlur,
  onReady,
  showToolbar = false,
  toolbarLabel = 'Formatting',
  disabled = false,
  readOnly = false,
  placeholder = 'Enter a description',
  ariaLabel,
  ariaLabelledBy,
  ariaDescribedBy,
  invalid = false,
  allowExpand,
  expandedTitle = 'Description',
  className,
  minHeightClassName = 'min-h-40',
}: RichDescriptionEditorProps) {
  const editable = !disabled && !readOnly;

  // Keep the latest onChange in a ref so a new inline callback each render does not need to be
  // a dependency of the editor (which would recreate it and lose selection/history).
  const onChangeRef = React.useRef(onChange);
  React.useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  const onBlurRef = React.useRef(onBlur);
  React.useEffect(() => {
    onBlurRef.current = onBlur;
  }, [onBlur]);

  // Computed once: the editor is created a single time and `value` is initial content only.
  const [initialContent] = React.useState(() => toInitialContent(value));

  // Tiptap emits one onUpdate while it sets the initial content. Forwarding that would mark a
  // pristine form dirty the moment the editor mounts (and, in a create flow, look like the
  // user typed), so the first update is swallowed and only real edits are emitted.
  const readyRef = React.useRef(false);

  // Clicking an equation opens the edit dialog. The extension list is built once (rebuilding it
  // would recreate the editor), so the handler goes through a ref that the state setter below
  // fills in.
  const openMathRef = React.useRef<(target: MathClickTarget) => void>(() => {});
  const [extensions] = React.useState(() =>
    createRichDescriptionExtensions({ onMathClick: (target) => openMathRef.current(target) }),
  );

  const editor = useEditor({
    extensions,
    content: initialContent,
    editable,
    // Server-render nothing and mount on the client: Tiptap needs the DOM, and rendering the
    // document during SSR then hydrating produces a mismatch.
    immediatelyRender: false,
    // The accessible name/description/invalid state must live on the contenteditable itself
    // (ProseMirror already puts role="textbox" there); duplicating role on a wrapper would
    // expose two textboxes to assistive tech.
    editorProps: {
      attributes: {
        role: 'textbox',
        'aria-multiline': 'true',
        ...(ariaLabelledBy ? { 'aria-labelledby': ariaLabelledBy } : {}),
        ...(!ariaLabelledBy && ariaLabel ? { 'aria-label': ariaLabel } : {}),
        ...(ariaDescribedBy ? { 'aria-describedby': ariaDescribedBy } : {}),
        ...(invalid ? { 'aria-invalid': 'true' } : {}),
      },
    },
    onCreate: () => {
      readyRef.current = true;
    },
    onUpdate: ({ editor: instance }) => {
      if (!readyRef.current) return;
      onChangeRef.current?.({
        version: RICH_DESCRIPTION_VERSION,
        document: instance.getJSON() as RichDescriptionEnvelope['document'],
      });
    },
    onBlur: () => onBlurRef.current?.(),
  });

  // Editability can change after creation (a form disables while submitting).
  React.useEffect(() => {
    editor?.setEditable(editable);
  }, [editor, editable]);

  // Hand out the operation seam once the editor exists.
  const onReadyRef = React.useRef(onReady);
  React.useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);
  React.useEffect(() => {
    if (!editor) return;
    onReadyRef.current?.({
      insertText: (text: string) => editor.chain().focus().insertContent(text).run(),
      selectAll: () => editor.chain().focus().selectAll().run(),
      isEmpty: () => editor.isEmpty,
    });
  }, [editor]);

  // The link dialog lives here (not in the toolbar) so the editor stays the single owner of
  // editor-affecting UI, and the dialog is reachable even with the toolbar hidden.
  const [linkDialogOpen, setLinkDialogOpen] = React.useState(false);

  // Equation dialog. `mathTarget` null means "insert a new equation"; a target means the author
  // clicked an existing one and is editing it in place.
  const [equationDialogOpen, setEquationDialogOpen] = React.useState(false);
  const [mathTarget, setMathTarget] = React.useState<MathClickTarget | null>(null);
  openMathRef.current = (target) => {
    if (!editable) return;
    setMathTarget(target);
    setEquationDialogOpen(true);
  };
  const openEquationDialog = () => {
    setMathTarget(null);
    setEquationDialogOpen(true);
  };

  // Ctrl/Cmd+K opens the link dialog, matching the tooltip and the usual convention.
  React.useEffect(() => {
    if (!editor || !editable) return;
    const dom = editor.view.dom;
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setLinkDialogOpen(true);
      }
    };
    dom.addEventListener('keydown', onKeyDown);
    return () => dom.removeEventListener('keydown', onKeyDown);
  }, [editor, editable]);

  // Expanded (full-viewport) editing. One flag; the SAME editor is rendered either inline or
  // inside the overlay, never two of them.
  const canExpand = allowExpand ?? showToolbar;
  const [expanded, setExpanded] = React.useState(false);
  const expandButtonRef = React.useRef<HTMLButtonElement>(null);
  // Set while collapsing so focus returns to the (re-rendered) Expand button afterwards.
  const restoreFocusRef = React.useRef(false);

  React.useEffect(() => {
    if (expanded || !restoreFocusRef.current) return;
    restoreFocusRef.current = false;
    expandButtonRef.current?.focus();
  }, [expanded]);

  const collapse = React.useCallback(() => {
    restoreFocusRef.current = true;
    setExpanded(false);
  }, []);

  // `editor.isEmpty` is mutable editor state, not React state, so track it explicitly:
  // reading it during render alone would never re-run when the document changes and the
  // placeholder would stick around after the first character.
  const [isEmpty, setIsEmpty] = React.useState(true);
  React.useEffect(() => {
    if (!editor) return;
    const sync = () => setIsEmpty(editor.isEmpty);
    sync();
    editor.on('update', sync);
    return () => {
      editor.off('update', sync);
    };
  }, [editor]);

  /**
   * The editor body: toolbar plus document. Rendered in exactly one place at a time, either
   * inline in the form or inside the expanded overlay. Moving it re-parents the SAME
   * ProseMirror view (Tiptap's EditorContent re-attaches `editor.view.dom` on mount and does
   * not destroy it on unmount), so the document, selection, and undo history all survive the
   * switch and there is never a second editor.
   */
  const body = (
    <div
      data-slot="rich-description-editor"
      data-expanded={expanded ? 'true' : undefined}
      className={cn(
        // Mirrors the Textarea's chrome so the editor sits in a form as a peer control.
        'border-input dark:bg-input/30 relative w-full rounded-md border bg-transparent text-base shadow-xs transition-[color,box-shadow] md:text-sm',
        'focus-within:border-ring focus-within:ring-ring/50 focus-within:ring-[3px]',
        invalid && 'border-destructive ring-destructive/20 dark:ring-destructive/40',
        disabled && 'cursor-not-allowed opacity-50',
        // Expanded: fill the overlay, no rounded card chrome, and let the document scroll
        // rather than the whole overlay, which keeps the toolbar in view.
        expanded && 'flex min-h-0 flex-1 flex-col rounded-none border-0 shadow-none ring-0',
        className,
      )}
    >
      {showToolbar && (
        <RichDescriptionToolbar
          editor={editor}
          label={toolbarLabel}
          onOpenLinkDialog={() => setLinkDialogOpen(true)}
          onOpenEquationDialog={openEquationDialog}
          // Enter-only, and absent while expanded: the overlay header owns the exit control, so
          // there is exactly one "Exit expanded view" button on screen.
          onExpand={canExpand && !expanded ? () => setExpanded(true) : undefined}
          expandButtonRef={expandButtonRef}
          // Sticky while expanded so it stays reachable through a long document.
          className={expanded ? 'bg-background sticky top-0 z-10' : undefined}
        />
      )}
      <LinkDialog editor={editor} open={linkDialogOpen} onOpenChange={setLinkDialogOpen} />
      <EquationDialog
        editor={editor}
        open={equationDialogOpen}
        onOpenChange={setEquationDialogOpen}
        target={mathTarget}
      />
      {/* The document area is its own positioning context so the placeholder overlays the text
          and never the toolbar above it. */}
      <div className={cn('relative', expanded && 'min-h-0 flex-1 overflow-y-auto')}>
        {/* Placeholder is rendered here (not via the Placeholder extension) so it needs no extra
            dependency and stays out of the document. aria-hidden: the accessible name comes from
            the field label, and screen readers announce the empty textbox already. */}
        {isEmpty && (
          <div
            aria-hidden="true"
            className={cn(
              'text-muted-foreground pointer-events-none absolute px-3 py-2 select-none',
              expanded && 'inset-x-0 mx-auto max-w-3xl',
            )}
          >
            {placeholder}
          </div>
        )}
        {/* ARIA lives on the contenteditable via editorProps.attributes above, so this wrapper
            stays a plain container (a second role="textbox" would double up for screen readers). */}
        <EditorContent
          editor={editor}
          // Long words and code must wrap rather than scroll the page sideways. The min-height
          // goes on this wrapper (a runtime-built Tailwind class would not be generated), and
          // `.tiptap` stretches to fill it so clicking the blank area focuses the document.
          //
          // Expanded caps the measure at max-w-3xl: the overlay is as wide as the viewport, but
          // prose set to a 2000px line length is unreadable.
          className={cn(
            'afct-rich-text px-3 py-2 break-words [&_.tiptap]:h-full [&_.tiptap]:outline-none',
            expanded ? 'mx-auto min-h-full w-full max-w-3xl py-6' : minHeightClassName,
          )}
        />
      </div>
    </div>
  );

  if (!expanded) return body;

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) collapse();
      }}
    >
      {/* Radix gives the overlay its focus trap, background scroll lock, and inert background
          for free, and it nests correctly: when the link or equation dialog is open, Escape
          closes THAT dialog and leaves this one open, which is exactly the required behaviour.
          The class overrides turn the centred card into a full-viewport surface (h-dvh, not
          h-screen, so a mobile browser's dynamic toolbar does not clip the bottom). */}
      <DialogContent
        showCloseButton={false}
        className="flex h-dvh w-screen max-w-none flex-col gap-0 overflow-hidden rounded-none border-0 p-0 sm:max-w-none"
        aria-describedby={undefined}
      >
        <DialogHeader className="border-input flex-row items-center justify-between gap-4 border-b px-4 py-3 text-left">
          <div className="min-w-0">
            <DialogTitle className="truncate text-base">{expandedTitle}</DialogTitle>
            <p className="text-muted-foreground mt-0.5 text-xs">
              {/* States plainly that this view does not save. Expanded mode deliberately has no
                  Save button: a second save path is worse than making the author close first. */}
              Close this view to return to the form, then save your changes.
            </p>
          </div>
          <Button type="button" variant="secondary" size="sm" onClick={collapse}>
            Exit expanded view
          </Button>
        </DialogHeader>
        {/* pb keeps the last line clear of a phone's home indicator. */}
        <div className="flex min-h-0 flex-1 flex-col pb-[env(safe-area-inset-bottom)]">{body}</div>
      </DialogContent>
    </Dialog>
  );
}

export default RichDescriptionEditor;
