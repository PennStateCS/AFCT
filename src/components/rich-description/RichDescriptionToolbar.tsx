'use client';

import * as React from 'react';
import type { Editor } from '@tiptap/react';
import { useEditorState } from '@tiptap/react';
import {
  Bold,
  Code,
  Italic,
  List,
  ListOrdered,
  Minus,
  Quote,
  Redo2,
  SquareCode,
  Underline as UnderlineIcon,
  Undo2,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Toggle } from '@/components/ui/toggle';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/** The paragraph/heading choices. H1 is reserved for the page itself. */
const BLOCK_OPTIONS = [
  { value: 'paragraph', label: 'Paragraph' },
  { value: 'heading-2', label: 'Heading 2' },
  { value: 'heading-3', label: 'Heading 3' },
  { value: 'heading-4', label: 'Heading 4' },
] as const;

type BlockValue = (typeof BLOCK_OPTIONS)[number]['value'];

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
        bulletList: instance.isActive('bulletList'),
        orderedList: instance.isActive('orderedList'),
        block: (instance.isActive('heading', { level: 2 })
          ? 'heading-2'
          : instance.isActive('heading', { level: 3 })
            ? 'heading-3'
            : instance.isActive('heading', { level: 4 })
              ? 'heading-4'
              : 'paragraph') as BlockValue,
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
      role="toolbar"
      aria-label={label}
      aria-orientation="horizontal"
      // Wraps rather than hiding controls behind an overflow menu on narrow screens, so every
      // formatting command stays reachable.
      className={cn(
        'border-input flex flex-wrap items-center gap-1 border-b px-2 py-1.5',
        className,
      )}
    >
      {/* History: plain actions, not toggles. */}
      <ToolbarTooltip label="Undo (Ctrl+Z)">
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
      <ToolbarTooltip label="Redo (Ctrl+Shift+Z)">
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
      <Select value={state.block} onValueChange={(v) => setBlock(v as BlockValue)} disabled={disabledAll}>
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
      <ToolbarTooltip label="Bold (Ctrl+B)">
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
      <ToolbarTooltip label="Italic (Ctrl+I)">
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
      <ToolbarTooltip label="Underline (Ctrl+U)">
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
      <ToolbarTooltip label="Inline code (Ctrl+E)">
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
    </div>
  );
}

export default RichDescriptionToolbar;
