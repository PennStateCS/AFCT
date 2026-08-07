/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { RichDescriptionEditor, type RichDescriptionEditorHandle } from './RichDescriptionEditor';
import type { RichDescriptionEnvelope } from '@/lib/rich-description';

const globalWithReact = globalThis as typeof globalThis & { React?: typeof React };
globalWithReact.React = React;

const para = (text: string, align?: string) => ({
  type: 'paragraph',
  ...(align ? { attrs: { textAlign: align } } : {}),
  content: [{ type: 'text', text }],
});
const heading = (level: number, text: string, align?: string) => ({
  type: 'heading',
  attrs: { level, ...(align ? { textAlign: align } : {}) },
  content: [{ type: 'text', text }],
});
const doc = (...content: unknown[]) =>
  ({ version: 1, document: { type: 'doc', content } }) as unknown as RichDescriptionEnvelope;

/** Mount the editor with a document, and expose the handle so tests can drive the selection. */
async function setup(value: RichDescriptionEnvelope) {
  let handle: RichDescriptionEditorHandle | null = null;
  render(
    <RichDescriptionEditor
      value={value}
      showToolbar
      ariaLabel="Description"
      onReady={(h) => {
        handle = h;
      }}
    />,
  );
  await screen.findByRole('textbox');
  await waitFor(() => expect(handle).not.toBeNull());
  return handle as unknown as RichDescriptionEditorHandle;
}

const alignButton = (name: 'Align left' | 'Align center' | 'Align right') =>
  screen.getByRole('radio', { name }) ?? screen.getByRole('button', { name });

function pressedAlignments(): string[] {
  return screen
    .getAllByRole('radio')
    .filter(
      (el) => el.getAttribute('aria-checked') === 'true' || el.getAttribute('data-state') === 'on',
    )
    .map((el) => el.getAttribute('aria-label') ?? '');
}

/**
 * The bug: `isActive` reports whether the selection is WITHIN a match, so a selection spanning a
 * centred and a right-aligned paragraph matched neither and fell back to `left`. The toolbar then
 * showed Left as pressed for a selection containing no left-aligned text at all.
 */
describe('alignment reporting', () => {
  it('reports left for a collapsed cursor in an unaligned paragraph', async () => {
    const handle = await setup(doc(para('plain')));
    handle.selectAll();
    await waitFor(() => expect(pressedAlignments()).toEqual(['Align left']));
  });

  it('reports left when every selected block is left or unaligned', async () => {
    const handle = await setup(doc(para('one'), para('two', 'left')));
    handle.selectAll();
    await waitFor(() => expect(pressedAlignments()).toEqual(['Align left']));
  });

  it('reports center when every selected block is centered', async () => {
    const handle = await setup(doc(para('one', 'center'), para('two', 'center')));
    handle.selectAll();
    await waitFor(() => expect(pressedAlignments()).toEqual(['Align center']));
  });

  it('reports right when every selected block is right aligned', async () => {
    const handle = await setup(doc(para('one', 'right'), para('two', 'right')));
    handle.selectAll();
    await waitFor(() => expect(pressedAlignments()).toEqual(['Align right']));
  });

  it.each([
    ['left and center', para('a'), para('b', 'center')],
    ['center and right', para('a', 'center'), para('b', 'right')],
    ['left and right', para('a'), para('b', 'right')],
  ])('shows no alignment pressed for a mixed selection of %s', async (_label, first, second) => {
    const handle = await setup(doc(first, second));
    handle.selectAll();
    // The whole point: a mixed selection must not claim any single alignment.
    await waitFor(() => expect(pressedAlignments()).toEqual([]));
  });

  it('treats a heading and a paragraph with the same alignment as that alignment', async () => {
    const handle = await setup(doc(heading(2, 'title', 'center'), para('body', 'center')));
    handle.selectAll();
    await waitFor(() => expect(pressedAlignments()).toEqual(['Align center']));
  });

  it('applies an alignment across a mixed selection', async () => {
    const handle = await setup(doc(para('a'), para('b', 'right')));
    handle.selectAll();
    await waitFor(() => expect(pressedAlignments()).toEqual([]));

    alignButton('Align center').click();
    // Every supported block moved, so the selection is no longer mixed.
    await waitFor(() => expect(pressedAlignments()).toEqual(['Align center']));
  });
});

/**
 * Same shape of bug in the block picker: a selection spanning a paragraph and a heading reported
 * "Paragraph", which is wrong for half of it.
 */
describe('block style reporting', () => {
  const styleTrigger = () => screen.getByRole('combobox', { name: 'Text style' });

  it('reports the current type for a collapsed cursor', async () => {
    await setup(doc(heading(2, 'title')));
    await waitFor(() => expect(styleTrigger()).toHaveTextContent('Heading 2'));
  });

  it('reports the shared type when every selected block matches', async () => {
    const handle = await setup(doc(heading(3, 'a'), heading(3, 'b')));
    handle.selectAll();
    await waitFor(() => expect(styleTrigger()).toHaveTextContent('Heading 3'));
  });

  it.each([
    ['paragraph and heading 2', para('a'), heading(2, 'b')],
    ['heading 2 and heading 3', heading(2, 'a'), heading(3, 'b')],
  ])('reports Multiple styles for %s', async (_label, first, second) => {
    const handle = await setup(doc(first, second));
    handle.selectAll();
    await waitFor(() => expect(styleTrigger()).toHaveTextContent('Multiple styles'));
  });

  it('reports Multiple styles across three different types', async () => {
    const handle = await setup(doc(para('a'), heading(2, 'b'), heading(4, 'c')));
    handle.selectAll();
    await waitFor(() => expect(styleTrigger()).toHaveTextContent('Multiple styles'));
  });

  it('does not offer Multiple styles as something to choose', async () => {
    const handle = await setup(doc(para('a'), heading(2, 'b')));
    handle.selectAll();
    await waitFor(() => expect(styleTrigger()).toHaveTextContent('Multiple styles'));
    // It describes the document; it is not a style. Radix shows it as a placeholder, so it is
    // never rendered as an option.
    expect(screen.queryByRole('option', { name: 'Multiple styles' })).toBeNull();
  });
});

describe('shortcut hints are deterministic', () => {
  it('names both modifiers rather than detecting the platform', async () => {
    await setup(doc(para('x')));
    // Reading `navigator` at module load meant the server rendered one string and the client
    // hydrated another. Naming both is correct on every platform and identical in both passes.
    const bold = screen.getByRole('button', { name: 'Bold' });
    expect(bold.getAttribute('aria-label')).toBe('Bold');

    const html = document.body.innerHTML;
    expect(html).not.toContain('Command+B');
    expect(html).not.toMatch(/\(Ctrl\+B\)/);
  });

  it('keeps the accessible name free of shortcut text', async () => {
    await setup(doc(para('x')));
    for (const name of ['Bold', 'Italic', 'Undo', 'Redo']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
  });
});

describe('no enabled control does nothing', () => {
  it('always supplies the link and equation callbacks', async () => {
    await setup(doc(para('x')));
    // The props are required now, so a toolbar cannot be constructed without them. These are the
    // two controls that used to be enabled with an optional callback behind them.
    expect(screen.getByRole('button', { name: 'Insert equation' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Add link' })).toBeEnabled();
  });

  it('disables every command control in a read-only editor', async () => {
    render(<RichDescriptionEditor readOnly showToolbar ariaLabel="Description" />);
    await screen.findByRole('textbox');

    const commands = [
      'Undo',
      'Redo',
      'Bold',
      'Italic',
      'Underline',
      'Inline code',
      'Add link',
      'Insert equation',
      'Bullet list',
      'Numbered list',
      'Quote',
      'Code block',
      'Horizontal rule',
    ];
    for (const name of commands) {
      const control = screen.queryByRole('button', { name });
      if (control) expect(control, `${name} should be disabled`).toBeDisabled();
    }
    expect(screen.getByRole('combobox', { name: 'Text style' })).toBeDisabled();
  });
});
