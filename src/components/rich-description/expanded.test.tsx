/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/components/ui/select', () => import('@/test/mocks/ui').then((mod) => mod.selectMock));

import { RichDescriptionEditor, type RichDescriptionEditorHandle } from './RichDescriptionEditor';
import type { RichDescriptionEnvelope } from '@/lib/rich-description';

const globalWithReact = globalThis as typeof globalThis & { React?: typeof React };
globalWithReact.React = React;

/**
 * Expanded mode is a real Radix dialog here, NOT the shared dialogMock: the whole point of the
 * stage is that the overlay mounts and unmounts, that Escape reaches the right layer, and that
 * focus comes back. A mock that always renders its children would prove none of that.
 */
async function setup(props: Record<string, unknown> = {}) {
  const onChange = vi.fn();
  let api: RichDescriptionEditorHandle | null = null;
  render(
    <RichDescriptionEditor
      showToolbar
      ariaLabel="Description"
      expandedTitle="Assignment description"
      onChange={onChange}
      onReady={(handle) => {
        api = handle;
      }}
      {...props}
    />,
  );
  await waitFor(() => {
    if (!document.querySelector('.tiptap')) throw new Error('not mounted');
  });
  await waitFor(() => expect(api).not.toBeNull());
  return { onChange, api: () => api! };
}

const expandButton = () => screen.getByRole('button', { name: 'Expand editor' });
const exitButton = () => screen.getByRole('button', { name: 'Exit expanded view' });
/** The one and only editor document node. */
const editors = () => document.querySelectorAll('.tiptap');

describe('expanded editing mode', () => {
  it('offers an Expand control whenever the toolbar is shown', async () => {
    await setup();
    expect(expandButton()).toBeInTheDocument();
  });

  it('can be suppressed with allowExpand={false}', async () => {
    await setup({ allowExpand: false });
    expect(screen.queryByRole('button', { name: 'Expand editor' })).toBeNull();
  });

  it('opens a labelled overlay and keeps exactly one editor', async () => {
    const user = userEvent.setup();
    await setup();
    expect(editors()).toHaveLength(1);

    await user.click(expandButton());

    // Radix announces the dialog by its title, which is the expanded-state announcement.
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Assignment description')).toBeInTheDocument();
    // The editor moved into the overlay; it was not duplicated.
    expect(editors()).toHaveLength(1);
    expect(exitButton()).toBeInTheDocument();
  });

  it('keeps unsaved content and undo history across expand and collapse', async () => {
    const user = userEvent.setup();
    const { api, onChange } = await setup();

    api().insertText('draft text');
    await waitFor(() => expect(onChange).toHaveBeenCalled());

    await user.click(expandButton());
    await screen.findByRole('dialog');
    // Same document, now inside the overlay.
    expect(document.querySelector('.tiptap')?.textContent).toContain('draft text');

    await user.click(exitButton());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.querySelector('.tiptap')?.textContent).toContain('draft text');

    // History survived the move: undo removes the text that was typed before expanding.
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() =>
      expect(document.querySelector('.tiptap')?.textContent).not.toContain('draft text'),
    );
  });

  it('Escape exits expanded mode', async () => {
    const user = userEvent.setup();
    await setup();

    await user.click(expandButton());
    await screen.findByRole('dialog');

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('returns focus to the Expand button after collapsing', async () => {
    const user = userEvent.setup();
    await setup();

    await user.click(expandButton());
    await screen.findByRole('dialog');
    await user.click(exitButton());

    await waitFor(() => expect(expandButton()).toHaveFocus());
  });

  it('Escape closes the equation dialog first and leaves expanded mode open', async () => {
    const user = userEvent.setup();
    await setup();

    await user.click(expandButton());
    await screen.findByRole('dialog');

    // Open a child dialog from inside the overlay.
    await user.click(screen.getByRole('button', { name: 'Insert equation' }));
    await waitFor(() => expect(screen.getByLabelText('LaTeX')).toBeInTheDocument());

    await user.keyboard('{Escape}');

    // The equation dialog closed; the expanded overlay did NOT.
    await waitFor(() => expect(screen.queryByLabelText('LaTeX')).toBeNull());
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(exitButton()).toBeInTheDocument();
  });

  it('does not submit the surrounding form when expanding or exiting', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <RichDescriptionEditor showToolbar ariaLabel="Description" />
      </form>,
    );
    await waitFor(() => {
      if (!document.querySelector('.tiptap')) throw new Error('not mounted');
    });

    await user.click(expandButton());
    await screen.findByRole('dialog');
    await user.click(exitButton());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('emits edits made while expanded, in the same versioned envelope', async () => {
    const user = userEvent.setup();
    const { onChange, api } = await setup();

    await user.click(expandButton());
    await screen.findByRole('dialog');

    api().insertText('typed while expanded');
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const last = onChange.mock.calls.at(-1)![0] as RichDescriptionEnvelope;
    expect(last.version).toBe(1);
    expect(JSON.stringify(last.document)).toContain('typed while expanded');
  });

  it('offers expanded mode on a read-only editor too, without making it editable', async () => {
    const user = userEvent.setup();
    await setup({ readOnly: true, value: 'Read me in a bigger window' });

    await user.click(expandButton());
    await screen.findByRole('dialog');

    const doc = document.querySelector('.tiptap') as HTMLElement;
    expect(doc.textContent).toContain('Read me in a bigger window');
    expect(doc.getAttribute('contenteditable')).toBe('false');
  });
});
