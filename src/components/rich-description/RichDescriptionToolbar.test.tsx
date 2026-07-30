/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';

// Radix Select needs pointer APIs jsdom lacks, so the repo's shared lightweight mock stands
// in (same approach as the other dialog tests). It renders the trigger and items as buttons.
vi.mock('@/components/ui/select', () => import('@/test/mocks/ui').then((mod) => mod.selectMock));

import { RichDescriptionEditor, type RichDescriptionEditorHandle } from './RichDescriptionEditor';
import { richDescriptionToPlainText, type RichDescriptionEnvelope } from '@/lib/rich-description';

const globalWithReact = globalThis as typeof globalThis & { React?: typeof React };
globalWithReact.React = React;

async function getEditable(): Promise<HTMLElement> {
  return await waitFor(() => {
    const el = document.querySelector('.tiptap');
    if (!el) throw new Error('editor not mounted yet');
    return el as HTMLElement;
  });
}

/** Render an editor with the toolbar, and expose a handle for programmatic edits. */
async function setup(props: Record<string, unknown> = {}) {
  const onChange = vi.fn();
  let api: RichDescriptionEditorHandle | null = null;
  render(
    <RichDescriptionEditor
      showToolbar
      ariaLabel="Description"
      onChange={onChange}
      onReady={(handle) => {
        api = handle;
      }}
      {...props}
    />,
  );
  const editable = await getEditable();
  await waitFor(() => expect(api).not.toBeNull());
  return { onChange, editable, api: () => api! };
}

describe('RichDescriptionToolbar', () => {
  it('renders a labelled toolbar with accessible names on every icon-only control', async () => {
    await setup();

    // A labelled group rather than role="toolbar": see the note in RichDescriptionToolbar.tsx.
    // Radix's ToggleGroup owns its own roving tabindex, so claiming toolbar semantics would
    // promise arrow-key navigation the composite cannot honour.
    const toolbar = screen.getByRole('group', { name: 'Formatting' });
    expect(toolbar).toBeInTheDocument();
    expect(screen.queryByRole('toolbar')).toBeNull();

    for (const name of [
      'Undo',
      'Redo',
      'Bold',
      'Italic',
      'Underline',
      'Inline code',
      'Bullet list',
      'Numbered list',
      'Quote',
      'Code block',
      'Horizontal rule',
    ]) {
      expect(screen.getByRole('button', { name }), `missing control: ${name}`).toBeInTheDocument();
    }
    // The block-type picker carries its own label (the mock renders it as a button).
    expect(screen.getByLabelText('Text style')).toBeInTheDocument();
  });

  it('reflects mark state in aria-pressed and toggles it from the editor, not local state', async () => {
    const user = userEvent.setup();
    const { api } = await setup();
    api().insertText('some text');

    const bold = screen.getByRole('button', { name: 'Bold' });
    expect(bold).toHaveAttribute('aria-pressed', 'false');

    await user.click(bold);
    await waitFor(() => expect(bold).toHaveAttribute('aria-pressed', 'true'));

    await user.click(bold);
    await waitFor(() => expect(bold).toHaveAttribute('aria-pressed', 'false'));
  });

  it('applies a mark that survives serialization', async () => {
    const user = userEvent.setup();
    const { api, onChange } = await setup();
    api().insertText('bolded');
    // Select the text so the mark applies to it rather than just the stored marks.
    await user.click(screen.getByRole('button', { name: 'Bold' }));

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const last = onChange.mock.calls.at(-1)![0] as RichDescriptionEnvelope;
    // Plain-text extraction keeps the text regardless of marks.
    expect(richDescriptionToPlainText(last)).toContain('bolded');
  });

  it('turns a paragraph into a heading through the block picker', async () => {
    const user = userEvent.setup();
    const { api, onChange } = await setup();
    api().insertText('Section title');

    await user.click(screen.getByRole('button', { name: 'Heading 2' }));

    await waitFor(() => {
      const last = onChange.mock.calls.at(-1)?.[0] as RichDescriptionEnvelope | undefined;
      expect(last?.document.content?.[0]?.type).toBe('heading');
    });
  });

  it('creates a bullet list and reports the active state', async () => {
    const user = userEvent.setup();
    const { api, onChange } = await setup();
    api().insertText('an item');

    const bullet = screen.getByRole('button', { name: 'Bullet list' });
    await user.click(bullet);

    await waitFor(() => expect(bullet).toHaveAttribute('aria-pressed', 'true'));
    const last = onChange.mock.calls.at(-1)![0] as RichDescriptionEnvelope;
    expect(last.document.content?.[0]?.type).toBe('bulletList');
  });

  it('inserts a horizontal rule', async () => {
    const user = userEvent.setup();
    const { onChange } = await setup();

    await user.click(screen.getByRole('button', { name: 'Horizontal rule' }));

    await waitFor(() => {
      const last = onChange.mock.calls.at(-1)?.[0] as RichDescriptionEnvelope | undefined;
      expect(last?.document.content?.some((n) => n.type === 'horizontalRule')).toBe(true);
    });
  });

  it('disables undo until there is history to undo', async () => {
    const { api } = await setup();

    const undo = screen.getByRole('button', { name: 'Undo' });
    expect(undo).toBeDisabled();

    api().insertText('now undoable');
    await waitFor(() => expect(undo).toBeEnabled());
  });

  it('disables every control when the editor is not editable', async () => {
    await setup({ disabled: true, value: 'locked' });

    for (const name of ['Bold', 'Italic', 'Bullet list', 'Horizontal rule']) {
      expect(screen.getByRole('button', { name })).toBeDisabled();
    }
  });

  it('is keyboard reachable and operable', async () => {
    const user = userEvent.setup();
    // No insertText on purpose. Bold applies to an empty selection as a stored mark, and seeding
    // text first triggers an editor update, which re-renders the toolbar through useEditorState
    // and can steal the focus this test just placed on the button.
    await setup();

    const bold = screen.getByRole('button', { name: 'Bold' });
    bold.focus();
    expect(bold).toHaveFocus();

    // Space activates a toggle for keyboard users. The generous timeout is for a loaded CI box:
    // the keypress runs a ProseMirror transaction and a toolbar re-render, which can take longer
    // than testing-library's 1s default when the machine is busy.
    await user.keyboard(' ');
    await waitFor(() => expect(bold).toHaveAttribute('aria-pressed', 'true'), { timeout: 5000 });
  });

  it('returns focus to the document after a toolbar command', async () => {
    const user = userEvent.setup();
    const { api, editable } = await setup();
    api().insertText('focus me');

    await user.click(screen.getByRole('button', { name: 'Bold' }));

    // Commands are chained through .focus(), so typing continues in the document.
    await waitFor(() => expect(editable).toHaveFocus());
  });

  it('renders no toolbar when showToolbar is false', async () => {
    render(<RichDescriptionEditor ariaLabel="Description" />);
    await getEditable();

    expect(screen.queryByRole('toolbar')).toBeNull();
  });
});
