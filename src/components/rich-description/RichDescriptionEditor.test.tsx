/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';

import { RichDescriptionEditor, type RichDescriptionEditorHandle } from './RichDescriptionEditor';
import { richDescriptionToPlainText, type RichDescriptionEnvelope } from '@/lib/rich-description';

const globalWithReact = globalThis as typeof globalThis & { React?: typeof React };
globalWithReact.React = React;

/** The contenteditable Tiptap renders. Waits for the client-only mount. */
async function getEditable(): Promise<HTMLElement> {
  return await waitFor(() => {
    const el = document.querySelector('.tiptap');
    if (!el) throw new Error('editor not mounted yet');
    return el as HTMLElement;
  });
}

describe('RichDescriptionEditor', () => {
  it('renders a plain-text initial value as document content', async () => {
    render(<RichDescriptionEditor ariaLabel="Description" value={'first line\nsecond line'} />);

    const editable = await getEditable();
    expect(editable.textContent).toContain('first line');
    expect(editable.textContent).toContain('second line');
  });

  it('renders a versioned envelope initial value', async () => {
    const value: RichDescriptionEnvelope = {
      version: 1,
      document: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'from json' }] }],
      },
    };
    render(<RichDescriptionEditor ariaLabel="Description" value={value} />);

    expect((await getEditable()).textContent).toContain('from json');
  });

  it('falls back to an empty document when the JSON is unsupported', async () => {
    // An unsupported node must not throw during render.
    const bad = { version: 1, document: { type: 'doc', content: [{ type: 'image' }] } } as never;
    render(<RichDescriptionEditor ariaLabel="Description" value={bad} />);

    expect((await getEditable()).textContent).toBe('');
  });

  // jsdom does no layout, so ProseMirror cannot map keystrokes to document positions there
  // (it needs selection/hit-testing). These drive the editor through its command API instead,
  // which exercises the same onUpdate -> envelope path a real keystroke would.
  it('emits a versioned envelope whose derived plain text matches the edit', async () => {
    const onChange = vi.fn();
    let api: RichDescriptionEditorHandle | null = null;
    render(
      <RichDescriptionEditor
        ariaLabel="Description"
        onChange={onChange}
        onReady={(handle) => {
          api = handle;
        }}
      />,
    );

    await getEditable();
    await waitFor(() => expect(api).not.toBeNull());
    api!.insertText('hello world');

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const last = onChange.mock.calls.at(-1)![0] as RichDescriptionEnvelope;
    expect(last.version).toBe(1);
    expect(last.document.type).toBe('doc');
    expect(richDescriptionToPlainText(last)).toContain('hello world');
  });

  it('shows the placeholder only while empty', async () => {
    let api: RichDescriptionEditorHandle | null = null;
    render(
      <RichDescriptionEditor
        ariaLabel="Description"
        placeholder="Describe the problem"
        onReady={(handle) => {
          api = handle;
        }}
      />,
    );

    expect(screen.getByText('Describe the problem')).toBeInTheDocument();

    await getEditable();
    await waitFor(() => expect(api).not.toBeNull());
    api!.insertText('x');

    await waitFor(() => expect(screen.queryByText('Describe the problem')).toBeNull());
  });

  it('does not accept input when disabled', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <RichDescriptionEditor ariaLabel="Description" disabled value="locked" onChange={onChange} />,
    );

    const editable = await getEditable();
    expect(editable.getAttribute('contenteditable')).toBe('false');

    await user.click(editable);
    await user.type(editable, 'nope');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('does not accept input when read-only', async () => {
    const onChange = vi.fn();
    render(
      <RichDescriptionEditor
        ariaLabel="Description"
        readOnly
        value="view me"
        onChange={onChange}
      />,
    );

    const editable = await getEditable();
    expect(editable.getAttribute('contenteditable')).toBe('false');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('exposes accessible name, description, and invalid state for validation', async () => {
    render(
      <>
        <span id="lbl">Description</span>
        <span id="err">Description is required</span>
        <RichDescriptionEditor ariaLabelledBy="lbl" ariaDescribedBy="err" invalid />
      </>,
    );

    const editable = await getEditable();
    // Exactly one textbox is exposed (ProseMirror's contenteditable), not a wrapper too.
    expect(document.querySelectorAll('[role="textbox"]')).toHaveLength(1);
    expect(editable).toHaveAttribute('role', 'textbox');
    expect(editable).toHaveAttribute('aria-labelledby', 'lbl');
    expect(editable).toHaveAttribute('aria-describedby', 'err');
    expect(editable).toHaveAttribute('aria-invalid', 'true');
    expect(editable).toHaveAttribute('aria-multiline', 'true');
  });

  it('does not emit a change just from mounting (a pristine form stays pristine)', async () => {
    const onChange = vi.fn();
    render(
      <RichDescriptionEditor ariaLabel="Description" value="existing text" onChange={onChange} />,
    );

    await getEditable();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('fires onBlur so a form can mark the field touched', async () => {
    const onBlur = vi.fn();
    const user = userEvent.setup();
    render(
      <>
        <RichDescriptionEditor ariaLabel="Description" onBlur={onBlur} />
        <button type="button">elsewhere</button>
      </>,
    );

    const editable = await getEditable();
    await user.click(editable);
    await user.click(screen.getByRole('button', { name: 'elsewhere' }));

    await waitFor(() => expect(onBlur).toHaveBeenCalled());
  });

  it('keeps one editor instance across re-renders with a new inline onChange', async () => {
    const { rerender } = render(
      <RichDescriptionEditor ariaLabel="Description" onChange={() => {}} />,
    );
    const first = await getEditable();

    rerender(<RichDescriptionEditor ariaLabel="Description" onChange={() => {}} />);
    const second = await getEditable();

    // Same DOM node means the editor was not torn down and rebuilt (which would drop
    // selection and undo history mid-edit).
    expect(second).toBe(first);
  });
});
