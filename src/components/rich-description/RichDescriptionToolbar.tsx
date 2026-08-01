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
  Keyboard,
  Link2,
  List,
  ListOrdered,
  Maximize2,
  Minus,
  MoreHorizontal,
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
import { EDITOR_SHORTCUTS, KeyboardShortcutsDialog } from './KeyboardShortcutsDialog';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/** The paragraph/heading choices. H1 is reserved for the page itself. */
const BLOCK_OPTIONS = [
  { value: 'paragraph', label: 'Paragraph' },
  { value: 'heading-2', label: 'Heading 2' },
  { value: 'heading-3', label: 'Heading 3' },
  { value: 'heading-4', label: 'Heading 4' },
] as const;

type BlockValue = (typeof BLOCK_OPTIONS)[number]['value'];

/** Supported alignments, in toolbar order. No justify. */
type AlignValue = (typeof ALLOWED_TEXT_ALIGN)[number];

/**
 * Alignment across the whole selection. `mixed` is a real answer, not an absence: it means the
 * selection genuinely contains more than one alignment, and no button should look pressed.
 */
type AlignmentState = AlignValue | 'mixed';

/** Block style across the whole selection, with the same explicit mixed case. */
type BlockState = BlockValue | 'mixed';

/**
 * The Select's value when the selection spans several styles. Empty string rather than a real
 * option, so Radix shows the placeholder and "Multiple styles" can never be CHOSEN: it describes
 * the document, it is not a style to apply.
 */
const MIXED_BLOCK_VALUE = '';

const ALIGN_OPTIONS: { value: AlignValue; label: string; Icon: typeof AlignLeft }[] = [
  { value: 'left', label: 'Align left', Icon: AlignLeft },
  { value: 'center', label: 'Align center', Icon: AlignCenter },
  { value: 'right', label: 'Align right', Icon: AlignRight },
];

/**
 * One command, described once.
 *
 * A command has a single definition: its label, its disabled rule, its pressed state, and what it
 * does. The toolbar button and the "More" menu item both render from this object, so they cannot
 * drift into disagreeing about whether something is disabled or already applied.
 *
 * `pressed` present means a toggle; absent means a plain action.
 */
export type ToolbarCommand = {
  id: string;
  /** The accessible name. Also the menu-item text in More. */
  label: string;
  /** Visible tooltip. Carries the shortcut, which the accessible name deliberately does not. */
  tooltip: string;
  Icon: typeof Bold;
  disabled: boolean;
  pressed?: boolean;
  run: (pressed: boolean) => void;
};

/**
 * Icon-only control: tooltip text doubles as the accessible name.
 *
 * The delay is deliberate. The shared Tooltip primitive opens instantly, which is right for a
 * lone control and oppressive on a toolbar: sweeping the mouse across it popped a tooltip per
 * icon. Accessibility does not need them open fast (every control's accessible name is its
 * aria-label; the tooltip is a sighted-user affordance), so these wait for a deliberate hover,
 * and the Keyboard shortcuts dialog carries the same information at leisure.
 */
function ToolbarTooltip({ label, children }: { label: string; children: React.ReactElement }) {
  return (
    <Tooltip delayDuration={600}>
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
  /** Required: an enabled control that does nothing is worse than a missing one. */
  onOpenLinkDialog: () => void;
  /** Asked to open the equation dialog for a new equation. */
  /**
   * Opens the equation dialog. With an equation selected this EDITS that equation; otherwise it
   * inserts a new one. The button's label and accessible name follow the same state, so the two
   * cannot disagree.
   */
  onOpenEquationDialog: () => void;
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
/**
 * What the block picker and the alignment group should report for the CURRENT selection.
 *
 * `isActive` cannot answer this. For a selection spanning two blocks it reports whether the
 * selection is "within" a match, so a centred paragraph next to a right-aligned one matched
 * neither alignment and the old code fell back to `left`, showing Left as pressed for a
 * selection that contains no left-aligned text at all. The block picker had the same shape of
 * bug and fell back to Paragraph across a paragraph plus a heading.
 *
 * So walk the blocks the selection actually touches and collect what is there. Only paragraphs
 * and headings are considered, because those are the only types TextAlign is configured for and
 * the only ones the picker offers: a code block or an equation in the selection is ignored
 * rather than being counted as an extra style.
 */
function inspectSelectedBlocks(instance: Editor): {
  align: AlignmentState;
  block: BlockState;
  canSetBlock: boolean;
} {
  const { from, to } = instance.state.selection;
  const aligns = new Set<string>();
  const blocks = new Set<string>();

  instance.state.doc.nodesBetween(from, to, (node) => {
    if (node.type.name === 'paragraph') blocks.add('paragraph');
    else if (node.type.name === 'heading') blocks.add(`heading-${node.attrs.level}`);
    else return true;

    // Left is stored as the absence of an attribute, so anything unrecognised reads as left.
    const raw = node.attrs.textAlign;
    const align =
      typeof raw === 'string' && (ALLOWED_TEXT_ALIGN as readonly string[]).includes(raw)
        ? raw
        : 'left';
    aligns.add(align);
    return true;
  });

  return {
    align: aligns.size > 1 ? 'mixed' : ((aligns.values().next().value ?? 'left') as AlignmentState),
    block:
      blocks.size > 1 ? 'mixed' : ((blocks.values().next().value ?? 'paragraph') as BlockState),
    // Nothing the picker can act on (a code block, say). Offering a style would be a lie.
    canSetBlock: blocks.size > 0,
  };
}

/**
 * A group of related controls that wraps as a unit.
 *
 * `flex-none` is the point: without it every control is an independent flex child, so a narrow
 * toolbar breaks wherever it runs out of room and strands one or two buttons (and sometimes a
 * separator) alone on the next row. Grouping keeps Undo with Redo, Bold with Italic, Link with
 * Equation, and the three alignment buttons intact.
 */
const Group = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <div className={cn('flex flex-none items-center gap-0.5', className)}>{children}</div>
);

/** Separators live BETWEEN groups, never inside one, so a wrap cannot strand one. */
const GroupDivider = ({ className }: { className?: string }) => (
  <Separator
    orientation="vertical"
    className={cn('mx-1 !h-6 flex-none', className)}
    aria-hidden="true"
  />
);

/**
 * The overflow menu: the same commands, as a menu, for toolbars too narrow to show them all.
 *
 * Rendered from the same `ToolbarCommand` array as the buttons it replaces. Which commands are in
 * here is the caller's decision; this component only knows how to draw them.
 *
 * Module scope, like `Group`: see the note there.
 */
export function ToolbarOverflowMenu({
  commands,
  label = 'More formatting',
}: {
  commands: ToolbarCommand[];
  label?: string;
}) {
  /**
   * Radix returns focus to the trigger when the menu closes, which is right for Escape or a click
   * away but wrong after running a command: the command already put the caret back in the
   * document, and pulling focus to a button would leave the user typing nowhere. So suppress the
   * restore only on the path where a command ran.
   */
  const commandRan = React.useRef(false);
  const markRan = () => {
    commandRan.current = true;
  };

  return (
    <DropdownMenu>
      <ToolbarTooltip label={label}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label={label}
            // Opening the menu blurs the editor, but Tiptap keeps the selection in its own state
            // and every command chains through `.focus()`, so the caret comes back where it was.
          >
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
      </ToolbarTooltip>
      <DropdownMenuContent
        align="start"
        onCloseAutoFocus={(event) => {
          if (!commandRan.current) return;
          commandRan.current = false;
          event.preventDefault();
        }}
      >
        {commands.map(({ id, label: name, Icon, disabled, pressed, run }) =>
          pressed === undefined ? (
            <DropdownMenuItem
              key={id}
              disabled={disabled}
              onSelect={() => {
                markRan();
                run(true);
              }}
            >
              <Icon />
              {name}
            </DropdownMenuItem>
          ) : (
            // A checkbox item, not a plain one: these commands have an on/off state, and the tick
            // is how the menu says the same thing the pressed toggle says in the toolbar.
            <DropdownMenuCheckboxItem
              key={id}
              checked={pressed}
              disabled={disabled}
              onSelect={markRan}
              onCheckedChange={run}
            >
              <Icon />
              {name}
            </DropdownMenuCheckboxItem>
          ),
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

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
        ...inspectSelectedBlocks(instance),
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

  // The shortcuts dialog is the toolbar's own: it needs no editor and holds no document state.
  const [shortcutsOpen, setShortcutsOpen] = React.useState(false);

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

  const chain = () => editor.chain().focus();

  const markCommands: ToolbarCommand[] = [
    {
      id: 'bold',
      label: 'Bold',
      tooltip: `Bold (${EDITOR_SHORTCUTS.bold})`,
      Icon: Bold,
      pressed: state.bold,
      disabled: disabledAll || !state.canBold,
      run: (pressed) => (pressed ? chain().setBold().run() : chain().unsetBold().run()),
    },
    {
      id: 'italic',
      label: 'Italic',
      tooltip: `Italic (${EDITOR_SHORTCUTS.italic})`,
      Icon: Italic,
      pressed: state.italic,
      disabled: disabledAll || !state.canItalic,
      run: (pressed) => (pressed ? chain().setItalic().run() : chain().unsetItalic().run()),
    },
    {
      id: 'underline',
      label: 'Underline',
      tooltip: `Underline (${EDITOR_SHORTCUTS.underline})`,
      Icon: UnderlineIcon,
      pressed: state.underline,
      disabled: disabledAll || !state.canUnderline,
      run: (pressed) => (pressed ? chain().setUnderline().run() : chain().unsetUnderline().run()),
    },
    {
      id: 'code',
      label: 'Inline code',
      tooltip: `Inline code (${EDITOR_SHORTCUTS.code})`,
      Icon: Code,
      pressed: state.code,
      disabled: disabledAll || !state.canCode,
      run: (pressed) => (pressed ? chain().setCode().run() : chain().unsetCode().run()),
    },
  ];

  const structureCommands: ToolbarCommand[] = [
    {
      id: 'bulletList',
      label: 'Bullet list',
      tooltip: 'Bullet list',
      Icon: List,
      pressed: state.bulletList,
      disabled: disabledAll || !state.canBulletList,
      run: (pressed) => {
        // Tiptap has no setList/unsetList pair, so guard on the live editor state: a repeated
        // request for the state we are already in does nothing rather than toggling back out.
        if (pressed === state.bulletList) return;
        chain().toggleBulletList().run();
      },
    },
    {
      id: 'orderedList',
      label: 'Numbered list',
      tooltip: 'Numbered list',
      Icon: ListOrdered,
      pressed: state.orderedList,
      disabled: disabledAll || !state.canOrderedList,
      run: (pressed) => {
        if (pressed === state.orderedList) return;
        chain().toggleOrderedList().run();
      },
    },
    {
      id: 'blockquote',
      label: 'Quote',
      tooltip: 'Quote',
      Icon: Quote,
      pressed: state.blockquote,
      disabled: disabledAll || !state.canBlockquote,
      run: (pressed) => (pressed ? chain().setBlockquote().run() : chain().unsetBlockquote().run()),
    },
    {
      id: 'codeBlock',
      label: 'Code block',
      tooltip: 'Code block',
      Icon: SquareCode,
      pressed: state.codeBlock,
      disabled: disabledAll || !state.canCodeBlock,
      // No unsetCodeBlock exists; leaving one means turning it back into a paragraph.
      run: (pressed) => (pressed ? chain().setCodeBlock().run() : chain().setParagraph().run()),
    },
    {
      id: 'horizontalRule',
      label: 'Horizontal rule',
      tooltip: 'Horizontal rule',
      Icon: Minus,
      // No pressed state: inserting a rule is an action, not something the caret can be "in".
      disabled: disabledAll || !state.canHorizontalRule,
      run: () => chain().setHorizontalRule().run(),
    },
  ];

  /**
   * Alignment, described the same way the other commands are, so the overflow menu can render it.
   *
   * The visible control stays a ToggleGroup: a block has exactly one alignment, and a radio group
   * says that in a way a row of independent buttons does not. In the menu the same three become
   * checkable items, where only one is ever ticked.
   */
  const alignCommands: ToolbarCommand[] = ALIGN_OPTIONS.map(({ value, label, Icon }) => ({
    id: `align-${value}`,
    label,
    tooltip: label,
    Icon,
    pressed: state.align === value,
    disabled: disabledAll || !state.canAlign,
    run: (pressed) => {
      // Choosing the alignment a block already has is a no-op, not a toggle back to unaligned.
      if (!pressed) return;
      const chain = editor.chain().focus();
      if (value === 'left') chain.unsetTextAlign().run();
      else chain.setTextAlign(value).run();
    },
  }));

  /** Render a command as a toolbar control, picking a toggle or a button from its shape. */
  const renderCommand = (command: ToolbarCommand) => {
    const { id, label: name, tooltip, Icon, disabled, pressed, run } = command;
    return (
      <ToolbarTooltip key={id} label={tooltip}>
        {pressed === undefined ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label={name}
            disabled={disabled}
            onClick={() => run(true)}
          >
            <Icon />
          </Button>
        ) : (
          <Toggle
            size="sm"
            aria-label={name}
            pressed={pressed}
            disabled={disabled}
            onPressedChange={run}
          >
            <Icon />
          </Toggle>
        )}
      </ToolbarTooltip>
    );
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
      // A container, so the controls respond to the width of the EDITOR rather than the window.
      // The same editor appears in a full-width form and in a narrow dialog column, and only the
      // container knows the difference. Still wraps below the overflow tier, so nothing is ever
      // cut off.
      className={cn(
        'border-input @container/toolbar flex flex-wrap items-center gap-x-1 gap-y-1.5 border-b px-2 py-1.5',
        className,
      )}
    >
      {/* History */}
      <Group>
        <ToolbarTooltip label={`Undo (${EDITOR_SHORTCUTS.undo})`}>
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
        <ToolbarTooltip label={`Redo (${EDITOR_SHORTCUTS.redo})`}>
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
      </Group>

      <GroupDivider />

      {/* Block style: a single-select, since a block is exactly one of these. */}
      <Group>
        <Select
          // A mixed selection falls back to the placeholder rather than naming one of the styles
          // it contains, which would be wrong for the rest of the selection.
          value={state.block === 'mixed' ? MIXED_BLOCK_VALUE : state.block}
          onValueChange={(v) => setBlock(v as BlockValue)}
          disabled={disabledAll || !state.canSetBlock}
        >
          <SelectTrigger size="sm" className="w-[8.5rem]" aria-label="Text style">
            <SelectValue placeholder="Multiple styles" />
          </SelectTrigger>
          <SelectContent>
            {BLOCK_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Group>

      <GroupDivider />

      {/* Inline formatting */}
      <Group>{markCommands.map(renderCommand)}</Group>

      <GroupDivider />

      {/* Insert and edit. Link and Equation belong together: both open a dialog, and both are
          contextual (add versus edit) on the same selection. */}
      <Group>
        {/* Inline marks: stateful toggles reporting pressed state. */}

        {/* Link: opens the dialog (URL entry needs validation, so it is not a bare toggle).
          Pressed state shows when the caret sits inside an existing link, which is also how a
          keyboard user reaches "edit this link". */}
        <ToolbarTooltip
          label={
            state.link
              ? `Edit link (${EDITOR_SHORTCUTS.link})`
              : `Add link (${EDITOR_SHORTCUTS.link})`
          }
        >
          <Toggle
            size="sm"
            aria-label={state.link ? 'Edit link' : 'Add link'}
            pressed={state.link}
            disabled={disabledAll}
            onPressedChange={() => onOpenLinkDialog()}
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
            onClick={onOpenEquationDialog}
          >
            <Sigma />
          </Button>
        </ToolbarTooltip>
      </Group>

      <GroupDivider className="@max-[40rem]/toolbar:hidden" />

      {/* Alignment: a single-select group, since a block has exactly one alignment. Radix's
          single type ignores a press on the already-selected item, so the user cannot toggle
          alignment off into an undefined state. Below the narrow tier it moves into the menu. */}
      {/* Must use the SAME threshold as the narrow overflow menu below, or alignment is on the
          bar and in the menu at once and the row never sheds the width it was supposed to. */}
      <Group className="@max-[44rem]/toolbar:hidden">
        <ToggleGroup
          type="single"
          size="sm"
          // 'mixed' maps to no value, so nothing reads as pressed for a selection that contains
          // more than one alignment. Showing Left pressed there would be a lie about the document.
          value={state.align === 'mixed' ? '' : state.align}
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
      </Group>

      <GroupDivider />

      {/* Structure. Below the tier these five collapse into the More menu, which is the whole
          reason the commands are described as data: the buttons and the menu items come from the
          same array, so they cannot disagree.

          52rem is roughly where the full row stops fitting, so the swap happens instead of the
          first wrap rather than after it. Exactly one of the two is displayed at any width, so no
          command is ever reachable twice. */}
      <Group className="@max-[52rem]/toolbar:hidden">{structureCommands.map(renderCommand)}</Group>

      {/* Two menus rather than one, because a menu cannot see the toolbar.
          Radix portals the menu content to the body, so it is outside the container and container
          queries do not reach it. One INSTANCE per tier sidesteps that: each has a fixed command
          list, and the container query only decides which trigger is displayed. Exactly one is
          ever visible, so nothing is reachable twice.

          Medium: the five structure commands. Narrow (a description inside a dialog): alignment
          joins them, which is what stops the row overflowing and stranding the expand button on a
          line of its own.

          The 44rem boundary is measured, not guessed. With alignment on the bar the row needs
          681px, and the assignment Details form is 670px wide (max-w-2xl), so a 40rem boundary
          put that page in a dead band where the medium tier applied but did not fit, and the
          trailing group wrapped. Re-measure before moving this: add a control and the number
          changes. */}
      <Group className="hidden @max-[52rem]/toolbar:@min-[44rem]/toolbar:flex">
        <ToolbarOverflowMenu commands={structureCommands} />
      </Group>
      <Group className="hidden @max-[44rem]/toolbar:flex">
        <ToolbarOverflowMenu commands={[...alignCommands, ...structureCommands]} />
      </Group>

      {/* The far-end group: controls about the editing surface, not the document. `ml-auto`
          belongs on the GROUP: the group is the flex child of the wrapping row, so on a button it
          pushed against nothing and never moved anything. Both stay enabled while the editor is
          read-only: reading a long description expanded, or looking up a shortcut, needs no edit
          permission. */}
      <Group className="ml-auto">
        <ToolbarTooltip label="Keyboard shortcuts">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label="Keyboard shortcuts"
            aria-haspopup="dialog"
            onClick={() => setShortcutsOpen(true)}
          >
            <Keyboard />
          </Button>
        </ToolbarTooltip>
        {onExpand && (
          <ToolbarTooltip label="Expand editor">
            <Button
              ref={expandButtonRef}
              type="button"
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label="Expand editor"
              onClick={onExpand}
            >
              <Maximize2 />
            </Button>
          </ToolbarTooltip>
        )}
      </Group>
      <KeyboardShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </div>
  );
}

export default RichDescriptionToolbar;
