'use client';

import * as React from 'react';
import type { Editor } from '@tiptap/react';
import { useEditorState } from '@tiptap/react';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Code,
  Italic,
  Link2,
  List,
  ListOrdered,
  Maximize2,
  Minus,
  Quote,
  Redo2,
  Sigma,
  SquareCode,
  Underline as UnderlineIcon,
  Undo2,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Toggle } from '@/components/ui/toggle';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { selectedMathTarget } from './extensions';
import { ALLOWED_TEXT_ALIGN } from '@/lib/rich-description';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/** The paragraph/heading choices. H1 is reserved for the page itself. */
/**
 * The modifier key name to show in a shortcut hint.
 *
 * macOS uses Command where Windows and Linux use Ctrl, and Tiptap's own bindings follow that, so
 * a hard-coded "Ctrl" is simply wrong on a Mac. Resolved once at module load rather than per
 * render, and guarded for the server, where there is no navigator.
 *
 * The action name still comes first in every label ("Bold (Command+B)"), so the accessible name
 * leads with what the control does rather than with keyboard trivia.
 */
const MOD_KEY = (() => {
  if (typeof navigator === 'undefined') return 'Ctrl';
  const platform = `${navigator.platform ?? ''} ${navigator.userAgent ?? ''}`;
  return /Mac|iPhone|iPad|iPod/i.test(platform) ? 'Command' : 'Ctrl';
})();

const BLOCK_OPTIONS = [
  { value: 'paragraph', label: 'Paragraph' },
  { value: 'heading-2', label: 'Heading 2' },
  { value: 'heading-3', label: 'Heading 3' },
  { value: 'heading-4', label: 'Heading 4' },
] as const;

type BlockValue = (typeof BLOCK_OPTIONS)[number]['value'];

/** Supported alignments, in toolbar order. No justify. */
type AlignValue = (typeof ALLOWED_TEXT_ALIGN)[number];

const ALIGN_OPTIONS: { value: AlignValue; label: string; Icon: typeof AlignLeft }[] = [
  { value: 'left', label: 'Align left', Icon: AlignLeft },
  { value: 'center', label: 'Align center', Icon: AlignCenter },
  { value: 'right', label: 'Align right', Icon: AlignRight },
];

/** Icon-only control: tooltip text doubles as the accessible name. */
function ToolbarTooltip({ label, children }: { label: string; children: React.ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export type RichDescriptionToolbarProps = {
  editor: Editor | null;
  /** Accessible name for the toolbar container. */
  label?: string;
  /** Asked to open the link dialog (the editor owns the dialog state). */
  onOpenLinkDialog?: () => void;
  /** Asked to open the equation dialog for a new equation. */
  onOpenEquationDialog?: () => void;
  /**
   * Asked to enter expanded editing. Omit to hide the control, which is also what the editor
   * does WHILE expanded: the overlay has its own clearly labelled exit button, and a second
   * control with the same accessible name would be ambiguous for voice and screen-reader users.
   */
  onExpand?: () => void;
  /** Receives the expand button so the editor can restore focus to it after exiting. */
  expandButtonRef?: React.Ref<HTMLButtonElement>;
  className?: string;
};

/**
 * Formatting toolbar for the rich-description editor.
 *
 * All button state is derived from the live editor (`isActive` / `can()`), never from separate
 * React state, so the controls always agree with the document and update as the cursor moves.
 * Commands are chained through `.focus()` so the caret returns to the document after a click.
 */
export function RichDescriptionToolbar({
  editor,
  label = 'Formatting',
  onOpenLinkDialog,
  onOpenEquationDialog,
  onExpand,
  expandButtonRef,
  className,
}: RichDescriptionToolbarProps) {
  // Subscribe to exactly the editor state the toolbar renders. useEditorState re-runs this
  // selector on every transaction (including selection-only moves) and re-renders when the
  // result changes, which is what keeps the toggles in step with the cursor.
  const state = useEditorState({
    editor,
    selector: ({ editor: instance }) => {
      if (!instance) return null;
      return {
        editable: instance.isEditable,
        bold: instance.isActive('bold'),
        italic: instance.isActive('italic'),
        underline: instance.isActive('underline'),
        code: instance.isActive('code'),
        blockquote: instance.isActive('blockquote'),
        codeBlock: instance.isActive('codeBlock'),
        link: instance.isActive('link'),
        bulletList: instance.isActive('bulletList'),
        orderedList: instance.isActive('orderedList'),
        block: (instance.isActive('heading', { level: 2 })
          ? 'heading-2'
          : instance.isActive('heading', { level: 3 })
            ? 'heading-3'
            : instance.isActive('heading', { level: 4 })
              ? 'heading-4'
              : 'paragraph') as BlockValue,
        // Alignment follows the cursor. Left is the default and is stored as no attribute, so
        // "nothing active" means left rather than an undefined state. A selection spanning
        // mixed alignments matches none of the three, which shows as no pressed button.
        align: (ALLOWED_TEXT_ALIGN.find((a) => instance.isActive({ textAlign: a })) ??
          'left') as AlignValue,
        canAlign: instance.can().chain().setTextAlign('center').run(),
        canUndo: instance.can().undo(),
        canRedo: instance.can().redo(),
        canBold: instance.can().chain().toggleBold().run(),
        canItalic: instance.can().chain().toggleItalic().run(),
        canUnderline: instance.can().chain().toggleUnderline().run(),
        canCode: instance.can().chain().toggleCode().run(),
        canBlockquote: instance.can().chain().toggleBlockquote().run(),
        canCodeBlock: instance.can().chain().toggleCodeBlock().run(),
        canBulletList: instance.can().chain().toggleBulletList().run(),
        canOrderedList: instance.can().chain().toggleOrderedList().run(),
        canHorizontalRule: instance.can().chain().setHorizontalRule().run(),
        // Drives the equation button's label. Selecting an atom is a selection change, so this
        // selector already re-runs at the right moment.
        mathSelected: selectedMathTarget(instance) !== null,
      };
    },
  });

  if (!editor || !state) return null;
  const disabledAll = !state.editable;

  const setBlock = (value: BlockValue) => {
    const chain = editor.chain().focus();
    if (value === 'paragraph') {
      chain.setParagraph().run();
      return;
    }
    const level = Number(value.split('-')[1]) as 2 | 3 | 4;
    chain.setHeading({ level }).run();
  };

  return (
    <div
      // A labelled GROUP, not role="toolbar", and that is a deliberate downgrade.
      //
      // role="toolbar" promises a composite widget: one tab stop, arrow keys moving between
      // controls, Home/End to the ends. This toolbar contains a Radix Select and a Radix
      // ToggleGroup, and ToggleGroup already implements its own roving tabindex and arrow-key
      // handling internally. A toolbar-level arrow handler would fight it, with two owners
      // managing the same tabindex, and arrow keys inside the alignment group would mean two
      // different things depending on which owner won.
      //
      // Announcing "toolbar" while arrow keys do not work is worse than not announcing it: a
      // screen-reader user is told to expect a keyboard model that is not there. Every control
      // is a normal tab stop, which is a correct and predictable pattern. If this is ever
      // revisited, the composite must treat the Select and the ToggleGroup as single stops and
      // delegate arrows into them.
      role="group"
      aria-label={label}
      // Wraps rather than hiding controls behind an overflow menu on narrow screens, so every
      // formatting command stays reachable.
      className={cn(
        'border-input flex flex-wrap items-center gap-1 border-b px-2 py-1.5',
        className,
      )}
    >
      {/* History: plain actions, not toggles. */}
      <ToolbarTooltip label={`Undo (${MOD_KEY}+Z)`}>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label="Undo"
          disabled={disabledAll || !state.canUndo}
          onClick={() => editor.chain().focus().undo().run()}
        >
          <Undo2 />
        </Button>
      </ToolbarTooltip>
      <ToolbarTooltip label={`Redo (${MOD_KEY}+Shift+Z)`}>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label="Redo"
          disabled={disabledAll || !state.canRedo}
          onClick={() => editor.chain().focus().redo().run()}
        >
          <Redo2 />
        </Button>
      </ToolbarTooltip>

      <Separator orientation="vertical" className="mx-1 !h-6" />

      {/* Block type: a single-select, since a block is exactly one of these. */}
      <Select
        value={state.block}
        onValueChange={(v) => setBlock(v as BlockValue)}
        disabled={disabledAll}
      >
        <SelectTrigger size="sm" className="w-[9.5rem]" aria-label="Text style">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {BLOCK_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Separator orientation="vertical" className="mx-1 !h-6" />

      {/* Inline marks: stateful toggles reporting pressed state. */}
      <ToolbarTooltip label={`Bold (${MOD_KEY}+B)`}>
        <Toggle
          size="sm"
          aria-label="Bold"
          pressed={state.bold}
          disabled={disabledAll || !state.canBold}
          onPressedChange={() => editor.chain().focus().toggleBold().run()}
        >
          <Bold />
        </Toggle>
      </ToolbarTooltip>
      <ToolbarTooltip label={`Italic (${MOD_KEY}+I)`}>
        <Toggle
          size="sm"
          aria-label="Italic"
          pressed={state.italic}
          disabled={disabledAll || !state.canItalic}
          onPressedChange={() => editor.chain().focus().toggleItalic().run()}
        >
          <Italic />
        </Toggle>
      </ToolbarTooltip>
      <ToolbarTooltip label={`Underline (${MOD_KEY}+U)`}>
        <Toggle
          size="sm"
          aria-label="Underline"
          pressed={state.underline}
          disabled={disabledAll || !state.canUnderline}
          onPressedChange={() => editor.chain().focus().toggleUnderline().run()}
        >
          <UnderlineIcon />
        </Toggle>
      </ToolbarTooltip>
      <ToolbarTooltip label={`Inline code (${MOD_KEY}+E)`}>
        <Toggle
          size="sm"
          aria-label="Inline code"
          pressed={state.code}
          disabled={disabledAll || !state.canCode}
          onPressedChange={() => editor.chain().focus().toggleCode().run()}
        >
          <Code />
        </Toggle>
      </ToolbarTooltip>

      {/* Link: opens the dialog (URL entry needs validation, so it is not a bare toggle).
          Pressed state shows when the caret sits inside an existing link, which is also how a
          keyboard user reaches "edit this link". */}
      <ToolbarTooltip label={state.link ? `Edit link (${MOD_KEY}+K)` : `Add link (${MOD_KEY}+K)`}>
        <Toggle
          size="sm"
          aria-label={state.link ? 'Edit link' : 'Add link'}
          pressed={state.link}
          disabled={disabledAll}
          onPressedChange={() => onOpenLinkDialog?.()}
        >
          <Link2 />
        </Toggle>
      </ToolbarTooltip>

      {/* Equations: one button, two actions. With an equation selected (by clicking it or by
          arrow-keying onto it, since both math nodes are atoms) this edits that equation;
          otherwise it inserts a new one. The visible tooltip and the accessible name are the
          same string, so voice control can say what it reads. */}
      <ToolbarTooltip label={state.mathSelected ? 'Edit equation' : 'Insert equation'}>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label={state.mathSelected ? 'Edit equation' : 'Insert equation'}
          disabled={disabledAll}
          onClick={() => onOpenEquationDialog?.()}
        >
          <Sigma />
        </Button>
      </ToolbarTooltip>

      <Separator orientation="vertical" className="mx-1 !h-6" />

      {/* Alignment: a single-select group, since a block has exactly one alignment. Radix's
          single type ignores a press on the already-selected item, so the user cannot toggle
          alignment off into an undefined state. */}
      <ToggleGroup
        type="single"
        size="sm"
        value={state.align}
        aria-label="Text alignment"
        disabled={disabledAll || !state.canAlign}
        onValueChange={(value) => {
          if (!value) return; // deselect attempt: keep the current alignment
          // Left is the absence of an alignment, so choosing it clears the attribute rather
          // than writing 'left'. Keeps plain paragraphs free of redundant attributes.
          const chain = editor.chain().focus();
          if (value === 'left') chain.unsetTextAlign().run();
          else chain.setTextAlign(value).run();
        }}
      >
        {ALIGN_OPTIONS.map(({ value, label, Icon }) => (
          <ToolbarTooltip key={value} label={label}>
            <ToggleGroupItem value={value} aria-label={label}>
              <Icon />
            </ToggleGroupItem>
          </ToolbarTooltip>
        ))}
      </ToggleGroup>

      <Separator orientation="vertical" className="mx-1 !h-6" />

      {/* Lists and blocks. */}
      <ToolbarTooltip label="Bullet list">
        <Toggle
          size="sm"
          aria-label="Bullet list"
          pressed={state.bulletList}
          disabled={disabledAll || !state.canBulletList}
          onPressedChange={() => editor.chain().focus().toggleBulletList().run()}
        >
          <List />
        </Toggle>
      </ToolbarTooltip>
      <ToolbarTooltip label="Numbered list">
        <Toggle
          size="sm"
          aria-label="Numbered list"
          pressed={state.orderedList}
          disabled={disabledAll || !state.canOrderedList}
          onPressedChange={() => editor.chain().focus().toggleOrderedList().run()}
        >
          <ListOrdered />
        </Toggle>
      </ToolbarTooltip>
      <ToolbarTooltip label="Quote">
        <Toggle
          size="sm"
          aria-label="Quote"
          pressed={state.blockquote}
          disabled={disabledAll || !state.canBlockquote}
          onPressedChange={() => editor.chain().focus().toggleBlockquote().run()}
        >
          <Quote />
        </Toggle>
      </ToolbarTooltip>
      <ToolbarTooltip label="Code block">
        <Toggle
          size="sm"
          aria-label="Code block"
          pressed={state.codeBlock}
          disabled={disabledAll || !state.canCodeBlock}
          onPressedChange={() => editor.chain().focus().toggleCodeBlock().run()}
        >
          <SquareCode />
        </Toggle>
      </ToolbarTooltip>
      <ToolbarTooltip label="Horizontal rule">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label="Horizontal rule"
          disabled={disabledAll || !state.canHorizontalRule}
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
        >
          <Minus />
        </Button>
      </ToolbarTooltip>

      {/* Expanded editing. Pushed to the far end (ml-auto) because it changes the whole
          editing surface rather than the document, so it does not belong among the
          formatting controls. Stays enabled while the editor is read-only: expanding to read
          a long description is useful even when it cannot be edited. */}
      {onExpand && (
        <ToolbarTooltip label="Expand editor">
          <Button
            ref={expandButtonRef}
            type="button"
            variant="ghost"
            size="icon"
            className="ml-auto size-8"
            aria-label="Expand editor"
            onClick={onExpand}
          >
            <Maximize2 />
          </Button>
        </ToolbarTooltip>
      )}
    </div>
  );
}

export default RichDescriptionToolbar;
