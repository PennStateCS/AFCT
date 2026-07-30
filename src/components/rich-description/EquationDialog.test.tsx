/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/components/ui/select', () => import('@/test/mocks/ui').then((mod) => mod.selectMock));
vi.mock('@/components/ui/dialog', () => import('@/test/mocks/ui').then((mod) => mod.dialogMock));
// The dialog mock renders children whether or not the dialog is open, so the editor's link
// dialog would add a second "Cancel" button. Real Radix keeps a closed dialog out of the DOM.
vi.mock('./LinkDialog', () => ({ LinkDialog: () => null }));

import { RichDescriptionEditor, type RichDescriptionEditorHandle } from './RichDescriptionEditor';
import {
  richDescriptionToPlainText,
  validateRichDescription,
  type RichDescriptionEnvelope,
  type TiptapNode,
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

/** The latest emitted document. */
function lastDoc(onChange: ReturnType<typeof vi.fn>) {
  return onChange.mock.calls.at(-1)?.[0] as RichDescriptionEnvelope | undefined;
}

/** Every node of a given type in the latest emitted document. */
function nodesOfType(onChange: ReturnType<typeof vi.fn>, type: string) {
  const found: TiptapNode[] = [];
  const walk = (nodes: TiptapNode[] = []) => {
    for (const node of nodes) {
      if (node.type === type) found.push(node);
      walk(node.content ?? []);
    }
  };
  walk(lastDoc(onChange)?.document.content ?? []);
  return found;
}

/**
 * Type LaTeX into a field. userEvent reads `{` and `[` as key descriptors, so they are doubled
 * to be typed literally; the field still receives the original text.
 */
function typeLatex(user: ReturnType<typeof userEvent.setup>, field: HTMLElement, latex: string) {
  return user.type(field, latex.replace(/[{[]/g, '$&$&'));
}

async function openInsertDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Insert equation' }));
  return screen.getByLabelText('LaTeX');
}

describe('equation dialog', () => {
  it('opens from the toolbar with a labelled field and a placement choice', async () => {
    const user = userEvent.setup();
    await setup();

    const field = await openInsertDialog(user);

    expect(field).toBeInTheDocument();
    expect(screen.getByText('Insert equation')).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Placement' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Inline' })).toBeChecked();
  });

  it('inserts an inline equation and keeps the LaTeX source in the plain-text fallback', async () => {
    const user = userEvent.setup();
    const { onChange, api } = await setup();
    api().insertText('There are ');

    const field = await openInsertDialog(user);
    await user.type(field, 'n^2');
    await user.click(screen.getByRole('button', { name: 'Save equation' }));

    await waitFor(() => expect(nodesOfType(onChange, 'inlineMath')).toHaveLength(1));
    expect(nodesOfType(onChange, 'inlineMath')[0].attrs?.latex).toBe('n^2');

    const doc = lastDoc(onChange)!;
    expect(validateRichDescription(doc).ok).toBe(true);
    expect(richDescriptionToPlainText(doc)).toBe('There are $n^2$');
  });

  it('inserts a display equation as its own block', async () => {
    const user = userEvent.setup();
    const { onChange } = await setup();

    const field = await openInsertDialog(user);
    await user.click(screen.getByRole('radio', { name: 'Display' }));
    await typeLatex(user, field, '\\sum_{i=1}^{n} i');
    await user.click(screen.getByRole('button', { name: 'Save equation' }));

    await waitFor(() => expect(nodesOfType(onChange, 'blockMath')).toHaveLength(1));
    const doc = lastDoc(onChange)!;
    expect(validateRichDescription(doc).ok).toBe(true);
    expect(richDescriptionToPlainText(doc)).toContain('$$\\sum_{i=1}^{n} i$$');
  });

  it('shows KaTeX feedback for malformed LaTeX and does not insert it', async () => {
    const user = userEvent.setup();
    const { onChange } = await setup();
    const callsBefore = onChange.mock.calls.length;

    const field = await openInsertDialog(user);
    await typeLatex(user, field, '\\frac{');

    // The message is visible immediately and is wired to the field through aria-describedby,
    // rather than being fired at a screen reader on every keystroke. See the a11y tests for the
    // polite, debounced announcement channel.
    const described = field.getAttribute('aria-describedby');
    expect(described).toBeTruthy();
    const errorText = document.getElementById(described!);
    expect(errorText?.textContent).toBeTruthy();
    expect(field).toHaveAttribute('aria-invalid', 'true');

    // An expression students would see as red error text cannot be saved.
    const save = screen.getByRole('button', { name: 'Save equation' });
    expect(save).toBeDisabled();
    await user.click(save);
    expect(screen.getByLabelText('LaTeX')).toBeInTheDocument();
    expect(onChange.mock.calls.length).toBe(callsBefore);
  });

  it('refuses an empty equation', async () => {
    const user = userEvent.setup();
    const { onChange } = await setup();
    const callsBefore = onChange.mock.calls.length;

    await openInsertDialog(user);

    // An empty equation cannot be saved, and the action does not pretend otherwise: the button
    // is disabled rather than inviting a click that would fail. Clicking it changes nothing.
    const save = screen.getByRole('button', { name: 'Save equation' });
    expect(save).toBeDisabled();
    await user.click(save);
    expect(onChange.mock.calls.length).toBe(callsBefore);

    // Whitespace counts as empty.
    await user.type(screen.getByLabelText('LaTeX'), '   ');
    expect(save).toBeDisabled();
    expect(onChange.mock.calls.length).toBe(callsBefore);
  });

  it('cancel leaves the document untouched', async () => {
    const user = userEvent.setup();
    const { onChange } = await setup();
    const callsBefore = onChange.mock.calls.length;

    const field = await openInsertDialog(user);
    await user.type(field, 'x+1');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onChange.mock.calls.length).toBe(callsBefore);
    expect(nodesOfType(onChange, 'inlineMath')).toHaveLength(0);
  });

  it('clicking a rendered equation reopens the dialog for editing, and it can be removed', async () => {
    const user = userEvent.setup();
    const { onChange } = await setup();

    const field = await openInsertDialog(user);
    await user.type(field, 'a+b');
    await user.click(screen.getByRole('button', { name: 'Save equation' }));
    await waitFor(() => expect(nodesOfType(onChange, 'inlineMath')).toHaveLength(1));

    // Clicking the node view is how a faculty member edits an existing equation.
    const rendered = document.querySelector('.tiptap [data-type="inline-math"]');
    expect(rendered).not.toBeNull();
    await user.click(rendered as Element);

    await waitFor(() => expect(screen.getByLabelText('LaTeX')).toHaveValue('a+b'));
    expect(screen.getByText('Edit equation')).toBeInTheDocument();

    await user.clear(screen.getByLabelText('LaTeX'));
    await user.type(screen.getByLabelText('LaTeX'), 'c-d');
    await user.click(screen.getByRole('button', { name: 'Update equation' }));
    await waitFor(() => expect(nodesOfType(onChange, 'inlineMath')[0]?.attrs?.latex).toBe('c-d'));

    await user.click(document.querySelector('.tiptap [data-type="inline-math"]') as Element);
    await user.click(await screen.findByRole('button', { name: 'Remove equation' }));
    await waitFor(() => expect(nodesOfType(onChange, 'inlineMath')).toHaveLength(0));
  });

  it('switching an existing equation from inline to display replaces the node', async () => {
    const user = userEvent.setup();
    const { onChange } = await setup();

    const field = await openInsertDialog(user);
    await user.type(field, 'x');
    await user.click(screen.getByRole('button', { name: 'Save equation' }));
    await waitFor(() => expect(nodesOfType(onChange, 'inlineMath')).toHaveLength(1));

    await user.click(document.querySelector('.tiptap [data-type="inline-math"]') as Element);
    await user.click(await screen.findByRole('radio', { name: 'Display' }));
    await user.click(screen.getByRole('button', { name: 'Update equation' }));

    await waitFor(() => expect(nodesOfType(onChange, 'blockMath')).toHaveLength(1));
    expect(nodesOfType(onChange, 'inlineMath')).toHaveLength(0);
  });
});
