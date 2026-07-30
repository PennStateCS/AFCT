'use client';

import * as React from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { cn } from '@/lib/utils';
import {
  RICH_DESCRIPTION_VERSION,
  plainTextToRichDescription,
  validateRichDescription,
  type RichDescriptionEnvelope,
} from '@/lib/rich-description';
import { richDescriptionExtensions } from './extensions';
import { RichDescriptionToolbar } from './RichDescriptionToolbar';

/**
 * A minimal handle onto the live editor. Deliberately narrow: callers drive the document
 * through named operations rather than reaching for the Tiptap instance, so the toolbar and
 * tests share one seam and the component keeps ownership of the editor.
 */
export type RichDescriptionEditorHandle = {
  insertText: (text: string) => void;
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

  const editor = useEditor({
    extensions: richDescriptionExtensions,
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
      isEmpty: () => editor.isEmpty,
    });
  }, [editor]);

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

  return (
    <div
      data-slot="rich-description-editor"
      className={cn(
        // Mirrors the Textarea's chrome so the editor sits in a form as a peer control.
        'border-input dark:bg-input/30 relative w-full rounded-md border bg-transparent text-base shadow-xs transition-[color,box-shadow] md:text-sm',
        'focus-within:border-ring focus-within:ring-ring/50 focus-within:ring-[3px]',
        invalid && 'border-destructive ring-destructive/20 dark:ring-destructive/40',
        disabled && 'cursor-not-allowed opacity-50',
        className,
      )}
    >
      {showToolbar && <RichDescriptionToolbar editor={editor} label={toolbarLabel} />}
      {/* The document area is its own positioning context so the placeholder overlays the text
          and never the toolbar above it. */}
      <div className="relative">
        {/* Placeholder is rendered here (not via the Placeholder extension) so it needs no extra
            dependency and stays out of the document. aria-hidden: the accessible name comes from
            the field label, and screen readers announce the empty textbox already. */}
        {isEmpty && (
          <div
            aria-hidden="true"
            className="text-muted-foreground pointer-events-none absolute px-3 py-2 select-none"
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
          className={cn(
            'afct-rich-text px-3 py-2 break-words [&_.tiptap]:h-full [&_.tiptap]:outline-none',
            minHeightClassName,
          )}
        />
      </div>
    </div>
  );
}

export default RichDescriptionEditor;
