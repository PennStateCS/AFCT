/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/components/ui/select', () => import('@/test/mocks/ui').then((mod) => mod.selectMock));

import { RichDescriptionEditor, type RichDescriptionEditorHandle } from './RichDescriptionEditor';
import {
  richDescriptionToPlainText,
  validateRichDescription,
  type RichDescriptionEnvelope,
} from '@/lib/rich-description';

const globalWithReact = globalThis as typeof globalThis & { React?: typeof React };
globalWithReact.React = React;

async function setup() {
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
    />,
  );
  await waitFor(() => {
    if (!document.querySelector('.tiptap')) throw new Error('not mounted');
  });
  await waitFor(() => expect(api).not.toBeNull());
  return { onChange, api: () => api! };
}

/** The first block node of the most recent emitted document. */
function lastBlock(onChange: ReturnType<typeof vi.fn>) {
  const last = onChange.mock.calls.at(-1)?.[0] as RichDescriptionEnvelope | undefined;
  return last?.document.content?.[0];
}

describe('rich description alignment', () => {
  it('offers exactly left, center, and right (no justify)', async () => {
    await setup();

    // Radix exposes a single-select ToggleGroup as a radiogroup, which is the correct
    // semantic for "exactly one of these".
    expect(screen.getByRole('radiogroup', { name: 'Text alignment' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Align left' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Align center' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Align right' })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: /justify/i })).toBeNull();
  });

  it('defaults to left with no stored attribute', async () => {
    const { api, onChange } = await setup();
    api().insertText('plain paragraph');

    expect(screen.getByRole('radio', { name: 'Align left' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    // Left is the default, so nothing is written into the document.
    expect(lastBlock(onChange)?.attrs?.textAlign ?? null).toBeNull();
  });

  it.each([
    ['Align center', 'center'],
    ['Align right', 'right'],
  ])('applies %s and persists it in the JSON', async (label, expected) => {
    const user = userEvent.setup();
    const { api, onChange } = await setup();
    api().insertText('aligned text');

    await user.click(screen.getByRole('radio', { name: label }));

    await waitFor(() => expect(lastBlock(onChange)?.attrs?.textAlign).toBe(expected));
    // And the stored document still validates against the supported schema.
    const last = onChange.mock.calls.at(-1)![0] as RichDescriptionEnvelope;
    expect(validateRichDescription(last).ok).toBe(true);
  });

  it('follows the cursor: the active button matches the current block', async () => {
    const user = userEvent.setup();
    const { api } = await setup();
    api().insertText('some text');

    await user.click(screen.getByRole('radio', { name: 'Align right' }));

    await waitFor(() =>
      expect(screen.getByRole('radio', { name: 'Align right' })).toHaveAttribute(
        'aria-checked',
        'true',
      ),
    );
    expect(screen.getByRole('radio', { name: 'Align left' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  it('switches cleanly between alignments', async () => {
    const user = userEvent.setup();
    const { api, onChange } = await setup();
    api().insertText('switch me');

    await user.click(screen.getByRole('radio', { name: 'Align center' }));
    await waitFor(() => expect(lastBlock(onChange)?.attrs?.textAlign).toBe('center'));

    // Back to left clears the attribute (left is the absence of an alignment).
    await user.click(screen.getByRole('radio', { name: 'Align left' }));
    await waitFor(() => expect(lastBlock(onChange)?.attrs?.textAlign ?? null).toBeNull());
  });

  it('cannot be toggled into an undefined state by re-pressing the active option', async () => {
    const user = userEvent.setup();
    const { api, onChange } = await setup();
    api().insertText('stay centered');

    const center = screen.getByRole('radio', { name: 'Align center' });
    await user.click(center);
    await waitFor(() => expect(lastBlock(onChange)?.attrs?.textAlign).toBe('center'));

    // Pressing the selected option again must not clear the alignment.
    await user.click(center);
    await waitFor(() => expect(center).toHaveAttribute('aria-checked', 'true'));
    expect(lastBlock(onChange)?.attrs?.textAlign).toBe('center');
  });

  it('is keyboard operable', async () => {
    const user = userEvent.setup();
    // No insertText here on purpose. Alignment applies to the empty paragraph just as well, and
    // seeding text first triggers an editor update, which re-renders the toolbar through
    // useEditorState and can steal the focus this test just placed on the button. Keeping the
    // document untouched makes the keypress land deterministically.
    const { onChange } = await setup();

    const center = screen.getByRole('radio', { name: 'Align center' });
    center.focus();
    expect(center).toHaveFocus();

    await user.keyboard(' ');
    await waitFor(() => expect(lastBlock(onChange)?.attrs?.textAlign).toBe('center'), {
      timeout: 5000,
    });
  });

  it('keeps the text in the plain-text fallback and drops the visual alignment', async () => {
    const user = userEvent.setup();
    const { api, onChange } = await setup();
    api().insertText('centered words');
    await user.click(screen.getByRole('radio', { name: 'Align center' }));

    await waitFor(() => expect(lastBlock(onChange)?.attrs?.textAlign).toBe('center'));
    const last = onChange.mock.calls.at(-1)![0] as RichDescriptionEnvelope;

    // Legacy clients receive plain text: the words survive and no alignment markup leaks in.
    const plain = richDescriptionToPlainText(last);
    expect(plain).toBe('centered words');
    expect(plain).not.toMatch(/text-align|data-align|textAlign/i);
  });

  it('rejects justify if it somehow reaches the validator', async () => {
    const doc = {
      version: 1,
      document: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            attrs: { textAlign: 'justify' },
            content: [{ type: 'text', text: 'x' }],
          },
        ],
      },
    };
    expect(validateRichDescription(doc).ok).toBe(false);
  });

  it('disables alignment when the editor is not editable', async () => {
    render(<RichDescriptionEditor showToolbar disabled value="locked" ariaLabel="Description" />);
    await waitFor(() => {
      if (!document.querySelector('.tiptap')) throw new Error('not mounted');
    });

    expect(screen.getByRole('radio', { name: 'Align center' })).toBeDisabled();
  });
});
