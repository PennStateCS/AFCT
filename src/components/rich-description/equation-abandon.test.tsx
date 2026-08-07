/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { Editor } from '@tiptap/core';

import { EquationDialog } from './EquationDialog';
import { createRichDescriptionExtensions } from './extensions';
import { INLINE_MATH_NODE } from '@/lib/rich-description';

const globalWithReact = globalThis as typeof globalThis & { React?: typeof React };
globalWithReact.React = React;

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

function makeEditor(content: unknown): Editor {
  const element = document.createElement('div');
  document.body.appendChild(element);
  editor = new Editor({
    element,
    extensions: createRichDescriptionExtensions(),
    content: content as never,
  });
  return editor;
}

const text = (value: string) => ({ type: 'text', text: value });
const inlineMath = (latex: string) => ({ type: INLINE_MATH_NODE, attrs: { latex } });
const doc = (...content: unknown[]) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content }],
});

/** Position and latex of the first inline equation. */
function findMath(instance: Editor): { pos: number; latex: string } {
  let found: { pos: number; latex: string } | null = null;
  instance.state.doc.descendants((node, pos) => {
    if (!found && node.type.name === INLINE_MATH_NODE) {
      found = { pos, latex: String(node.attrs.latex ?? '') };
      return false;
    }
    return true;
  });
  if (!found) throw new Error('no inline math node in the document');
  return found;
}

/** Open the dialog on the document's first equation, ready to be abandoned. */
function openOnEquation(instance: Editor) {
  const { pos, latex } = findMath(instance);
  const onOpenChange = vi.fn();
  const view = render(
    <EquationDialog
      editor={instance}
      open
      onOpenChange={onOpenChange}
      target={{ mode: 'inline', latex, pos }}
    />,
  );
  return { view, onOpenChange };
}

/**
 * Abandoning an edit must leave the document exactly as it was.
 *
 * The dialog holds the source in React state and only writes it into the document on submit, so
 * every one of these is really asking the same question: does anything other than Save touch the
 * document? An editor who types into the field, thinks better of it and presses Escape has not
 * asked for a change, and a half-typed expression is usually not valid LaTeX, so writing it would
 * both lose their equation and leave one the write path would reject.
 */
describe('abandoning an equation edit', () => {
  it('leaves the equation untouched when Cancel is clicked after typing', async () => {
    const instance = makeEditor(doc(text('before '), inlineMath('x^2'), text(' after')));
    const before = JSON.stringify(instance.getJSON());
    const { onOpenChange } = openOnEquation(instance);

    fireEvent.change(await screen.findByLabelText('LaTeX'), { target: { value: 'y^3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(JSON.stringify(instance.getJSON())).toBe(before);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('leaves the equation untouched when Escape closes the dialog', async () => {
    const instance = makeEditor(doc(text('before '), inlineMath('x^2'), text(' after')));
    const before = JSON.stringify(instance.getJSON());
    const { onOpenChange } = openOnEquation(instance);

    fireEvent.change(await screen.findByLabelText('LaTeX'), { target: { value: 'y^3' } });
    fireEvent.keyDown(screen.getByLabelText('LaTeX'), { key: 'Escape', code: 'Escape' });

    expect(JSON.stringify(instance.getJSON())).toBe(before);
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('does not write a half-typed expression the write path would reject', async () => {
    const instance = makeEditor(doc(inlineMath('x^2')));
    const before = JSON.stringify(instance.getJSON());
    openOnEquation(instance);

    // `\frac{1` is what an unfinished fraction looks like: KaTeX cannot parse it, so storing it
    // would fail validation on save.
    fireEvent.change(await screen.findByLabelText('LaTeX'), { target: { value: '\\frac{1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(JSON.stringify(instance.getJSON())).toBe(before);
  });

  it('reseeds from the document when the dialog is reopened, discarding the abandoned text', async () => {
    const instance = makeEditor(doc(inlineMath('x^2')));
    const first = openOnEquation(instance);

    fireEvent.change(await screen.findByLabelText('LaTeX'), { target: { value: 'nonsense' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    first.view.unmount();

    openOnEquation(instance);

    // The field shows the stored equation, not what was abandoned last time.
    const field = (await screen.findByLabelText('LaTeX')) as HTMLTextAreaElement;
    expect(field.value).toBe('x^2');
  });

  it('still applies the edit when the author does save, so the guard is not just inertia', async () => {
    const instance = makeEditor(doc(inlineMath('x^2')));
    openOnEquation(instance);

    fireEvent.change(await screen.findByLabelText('LaTeX'), { target: { value: 'y^3' } });
    fireEvent.submit(screen.getByLabelText('LaTeX').closest('form')!);

    await waitFor(() => expect(JSON.stringify(instance.getJSON())).toContain('y^3'));
    expect(JSON.stringify(instance.getJSON())).not.toContain('x^2');
  });
});
