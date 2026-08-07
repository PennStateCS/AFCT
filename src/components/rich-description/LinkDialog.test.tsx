/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/components/ui/select', () => import('@/test/mocks/ui').then((mod) => mod.selectMock));
vi.mock('@/components/ui/dialog', () => import('@/test/mocks/ui').then((mod) => mod.dialogMock));
// The dialog mock renders its children whether or not the dialog is open, so the editor's other
// dialog would put a second "Cancel" button on screen. Real Radix keeps a closed dialog out of
// the DOM entirely; stubbing it here keeps this file about links.
vi.mock('./EquationDialog', () => ({ EquationDialog: () => null }));

import { RichDescriptionEditor, type RichDescriptionEditorHandle } from './RichDescriptionEditor';
import { validateRichDescription, type RichDescriptionEnvelope } from '@/lib/rich-description';

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

/** All link marks in the most recent emitted document. */
function linkMarks(onChange: ReturnType<typeof vi.fn>) {
  const last = onChange.mock.calls.at(-1)?.[0] as RichDescriptionEnvelope | undefined;
  const marks: { type: string; attrs?: Record<string, unknown> }[] = [];
  const walk = (nodes: unknown[] = []) => {
    for (const node of nodes as { marks?: typeof marks; content?: unknown[] }[]) {
      for (const mark of node.marks ?? []) if (mark.type === 'link') marks.push(mark);
      walk(node.content ?? []);
    }
  };
  walk(last?.document.content ?? []);
  return marks;
}

describe('link dialog', () => {
  it('opens from the toolbar with an accessible name', async () => {
    const user = userEvent.setup();
    await setup();

    await user.click(screen.getByRole('button', { name: 'Add link' }));

    expect(await screen.findByText('Add link')).toBeInTheDocument();
    expect(screen.getByLabelText('Web address')).toBeInTheDocument();
  });

  it('applies a valid https link to the selected text', async () => {
    const user = userEvent.setup();
    const { onChange, api } = await setup();
    api().insertText('course page');
    api().selectAll();

    await user.click(screen.getByRole('button', { name: 'Add link' }));
    await user.type(screen.getByLabelText('Web address'), 'https://example.edu/course');
    await user.click(screen.getByRole('button', { name: 'Save link' }));

    await waitFor(() => {
      const marks = linkMarks(onChange);
      expect(marks.length).toBeGreaterThan(0);
      expect(marks[0].attrs?.href).toBe('https://example.edu/course');
    });
  });

  it('accepts a mailto link', async () => {
    const user = userEvent.setup();
    const { onChange, api } = await setup();
    api().insertText('email me');
    api().selectAll();

    await user.click(screen.getByRole('button', { name: 'Add link' }));
    await user.type(screen.getByLabelText('Web address'), 'mailto:prof@example.edu');
    await user.click(screen.getByRole('button', { name: 'Save link' }));

    await waitFor(() => {
      expect(linkMarks(onChange)[0]?.attrs?.href).toBe('mailto:prof@example.edu');
    });
  });

  it.each([
    ['javascript:alert(1)', /cannot use/i],
    ['data:text/html,<script>', /cannot use/i],
    ['http://example.edu', /https/i],
    ['not-a-url', /full web address/i],
  ])('refuses %s and shows a validation message instead of linking', async (url, pattern) => {
    const user = userEvent.setup();
    const { onChange, api } = await setup();
    api().insertText('some text');
    api().selectAll();
    const callsBefore = onChange.mock.calls.length;

    await user.click(screen.getByRole('button', { name: 'Add link' }));
    await user.type(screen.getByLabelText('Web address'), url);
    await user.click(screen.getByRole('button', { name: 'Save link' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(pattern);
    // No link mark was created, and the dialog stays open for a correction.
    expect(linkMarks(onChange)).toHaveLength(0);
    expect(screen.getByLabelText('Web address')).toBeInTheDocument();
    expect(onChange.mock.calls.length).toBe(callsBefore);
  });

  it('clears the error once the author edits the field', async () => {
    const user = userEvent.setup();
    const { api } = await setup();
    api().insertText('text');
    api().selectAll();

    await user.click(screen.getByRole('button', { name: 'Add link' }));
    await user.type(screen.getByLabelText('Web address'), 'javascript:alert(1)');
    await user.click(screen.getByRole('button', { name: 'Save link' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();

    await user.clear(screen.getByLabelText('Web address'));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('shows the selected text so the author can confirm what becomes the link', async () => {
    const user = userEvent.setup();
    const { api } = await setup();
    api().insertText('syllabus link text');
    api().selectAll();

    await user.click(screen.getByRole('button', { name: 'Add link' }));

    await waitFor(() =>
      expect(screen.getAllByText('syllabus link text').length).toBeGreaterThan(1),
    );
  });

  it('cancel leaves the document untouched', async () => {
    const user = userEvent.setup();
    const { onChange, api } = await setup();
    api().insertText('unchanged');
    api().selectAll();
    const callsBefore = onChange.mock.calls.length;

    await user.click(screen.getByRole('button', { name: 'Add link' }));
    await user.type(screen.getByLabelText('Web address'), 'https://example.edu');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onChange.mock.calls.length).toBe(callsBefore);
    expect(linkMarks(onChange)).toHaveLength(0);
  });

  it('edits and removes an existing link', async () => {
    const user = userEvent.setup();
    const { onChange, api } = await setup();
    api().insertText('link me');
    api().selectAll();

    // Create it first.
    await user.click(screen.getByRole('button', { name: 'Add link' }));
    await user.type(screen.getByLabelText('Web address'), 'https://old.example.edu');
    await user.click(screen.getByRole('button', { name: 'Save link' }));
    await waitFor(() =>
      expect(linkMarks(onChange)[0]?.attrs?.href).toBe('https://old.example.edu/'),
    );

    // The button now offers editing, seeded with the current href.
    api().selectAll();
    await user.click(await screen.findByRole('button', { name: 'Edit link' }));
    const field = screen.getByLabelText('Web address');
    await waitFor(() => expect(field).toHaveValue('https://old.example.edu/'));

    await user.clear(field);
    await user.type(field, 'https://new.example.edu');
    await user.click(screen.getByRole('button', { name: 'Update link' }));
    await waitFor(() =>
      expect(linkMarks(onChange)[0]?.attrs?.href).toBe('https://new.example.edu/'),
    );

    // And removal drops the mark entirely.
    api().selectAll();
    await user.click(await screen.findByRole('button', { name: 'Edit link' }));
    await user.click(screen.getByRole('button', { name: 'Remove link' }));
    await waitFor(() => expect(linkMarks(onChange)).toHaveLength(0));
  });

  it('links the whole selection when it spans linked and unlinked text', async () => {
    const user = userEvent.setup();
    const { onChange, api } = await setup();
    api().insertText('before and after');

    // Link only part of it first.
    api().selectAll();
    await user.click(screen.getByRole('button', { name: 'Add link' }));
    await user.type(screen.getByLabelText('Web address'), 'https://one.example.edu');
    await user.click(screen.getByRole('button', { name: 'Save link' }));
    await waitFor(() => expect(linkMarks(onChange)).not.toHaveLength(0));

    // Now re-link the same span with a different address: the whole selection ends up on the
    // new href rather than keeping a mixture of the two.
    api().selectAll();
    await user.click(await screen.findByRole('button', { name: 'Edit link' }));
    const field = screen.getByLabelText('Web address');
    await user.clear(field);
    await user.type(field, 'https://two.example.edu');
    await user.click(screen.getByRole('button', { name: 'Update link' }));

    await waitFor(() => {
      const hrefs = new Set(linkMarks(onChange).map((m) => m.attrs?.href));
      expect(hrefs).toEqual(new Set(['https://two.example.edu/']));
    });
  });

  it('keeps the text when the link is removed', async () => {
    const user = userEvent.setup();
    const { onChange, api } = await setup();
    api().insertText('keep this text');
    api().selectAll();

    await user.click(screen.getByRole('button', { name: 'Add link' }));
    await user.type(screen.getByLabelText('Web address'), 'https://example.edu');
    await user.click(screen.getByRole('button', { name: 'Save link' }));
    await waitFor(() => expect(linkMarks(onChange)).not.toHaveLength(0));

    api().selectAll();
    await user.click(await screen.findByRole('button', { name: 'Edit link' }));
    await user.click(screen.getByRole('button', { name: 'Remove link' }));

    await waitFor(() => expect(linkMarks(onChange)).toHaveLength(0));
    // Unlinking must not take the words with it.
    expect(JSON.stringify(onChange.mock.calls.at(-1)?.[0])).toContain('keep this text');
  });

  it('inserts the address as its own text when nothing is selected', async () => {
    const user = userEvent.setup();
    const { onChange } = await setup();

    // No selection: there is nothing to put a mark on, so the URL becomes the link text.
    await user.click(screen.getByRole('button', { name: 'Add link' }));
    await user.type(screen.getByLabelText('Web address'), 'https://example.edu');
    await user.click(screen.getByRole('button', { name: 'Save link' }));

    await waitFor(() => expect(linkMarks(onChange)).toHaveLength(1));
    const emitted = JSON.stringify(onChange.mock.calls.at(-1)?.[0]);
    expect(emitted).toContain('https://example.edu/');
    expect(linkMarks(onChange)[0]?.attrs?.href).toBe('https://example.edu/');
  });

  it('produces a document that still validates, and rejects an unsafe href at the schema level', async () => {
    const user = userEvent.setup();
    const { onChange, api } = await setup();
    api().insertText('valid link');
    api().selectAll();

    await user.click(screen.getByRole('button', { name: 'Add link' }));
    await user.type(screen.getByLabelText('Web address'), 'https://example.edu');
    await user.click(screen.getByRole('button', { name: 'Save link' }));

    await waitFor(() => expect(linkMarks(onChange).length).toBeGreaterThan(0));
    const last = onChange.mock.calls.at(-1)![0] as RichDescriptionEnvelope;
    expect(validateRichDescription(last).ok).toBe(true);

    // A hand-crafted payload with a javascript: href must not validate even though it never
    // went through the dialog.
    const hostile = {
      version: 1,
      document: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'click',
                marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
              },
            ],
          },
        ],
      },
    };
    expect(validateRichDescription(hostile).ok).toBe(false);
  });
});
