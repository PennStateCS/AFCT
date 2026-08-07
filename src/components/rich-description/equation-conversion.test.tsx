/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';

import { EquationDialog } from './EquationDialog';
import { createRichDescriptionExtensions } from './extensions';
import {
  BLOCK_MATH_NODE,
  INLINE_MATH_NODE,
  validateRichDescription,
  richDescriptionToPlainText,
  RICH_DESCRIPTION_VERSION,
} from '@/lib/rich-description';

const globalWithReact = globalThis as typeof globalThis & { React?: typeof React };
globalWithReact.React = React;

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

/** A real Tiptap editor over the AFCT extension set, so conversions run the actual commands. */
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

/** Position and latex of the first math node of the given type. */
function findMath(instance: Editor, type: string): { pos: number; latex: string } {
  let found: { pos: number; latex: string } | null = null;
  instance.state.doc.descendants((node, pos) => {
    if (!found && node.type.name === type) {
      found = { pos, latex: String(node.attrs.latex ?? '') };
      return false;
    }
    return true;
  });
  if (!found) throw new Error(`no ${type} node in the document`);
  return found;
}

function countNodes(json: unknown, type: string): number {
  return JSON.stringify(json).split(`"type":"${type}"`).length - 1;
}

function plainText(instance: Editor): string {
  return richDescriptionToPlainText({
    version: RICH_DESCRIPTION_VERSION,
    document: instance.getJSON() as never,
  });
}

/**
 * Drive a real conversion: open the dialog on an existing equation, switch its placement, save.
 * This exercises handleSubmit's delete-then-insert chain, which is the code whose position
 * mapping is in question.
 */
async function convert(instance: Editor, from: 'inline' | 'block', to: 'Inline' | 'Display') {
  const type = from === 'inline' ? INLINE_MATH_NODE : BLOCK_MATH_NODE;
  const { pos, latex } = findMath(instance, type);

  const view = render(
    <EquationDialog
      editor={instance}
      open
      onOpenChange={() => {}}
      target={{ mode: from, latex, pos }}
    />,
  );

  fireEvent.click(await screen.findByRole('radio', { name: to }));
  fireEvent.submit(screen.getByLabelText('LaTeX').closest('form')!);
  await waitFor(() => expect(screen.getByLabelText('LaTeX')).toBeInTheDocument());
  // Unmount before any following conversion, or a second dialog would leave two LaTeX fields.
  view.unmount();
}

const text = (value: string) => ({ type: 'text', text: value });
const inlineMath = (latex: string) => ({ type: INLINE_MATH_NODE, attrs: { latex } });
const blockMath = (latex: string) => ({ type: BLOCK_MATH_NODE, attrs: { latex } });
const para = (...content: unknown[]) => ({ type: 'paragraph', content });

/** Every conversion must leave a document the stored-format validator still accepts. */
function expectSchemaValid(instance: Editor) {
  const result = validateRichDescription({
    version: RICH_DESCRIPTION_VERSION,
    document: instance.getJSON(),
  });
  expect(result.ok, result.ok ? '' : `document became invalid: ${result.error}`).toBe(true);
}

describe('inline to display conversion', () => {
  it('converts in the middle of a paragraph without losing the surrounding text', async () => {
    const instance = makeEditor({
      type: 'doc',
      content: [para(text('before '), inlineMath('x^2'), text(' after'))],
    });

    await convert(instance, 'inline', 'Display');
    const json = instance.getJSON();

    expect(countNodes(json, BLOCK_MATH_NODE)).toBe(1);
    expect(countNodes(json, INLINE_MATH_NODE)).toBe(0);
    // The words on both sides survive, and are not duplicated.
    const serialized = JSON.stringify(json);
    expect(serialized).toContain('before ');
    expect(serialized).toContain(' after');
    expect(serialized.split('before ').length - 1).toBe(1);
    expectSchemaValid(instance);
  });

  it('converts at the start of a paragraph', async () => {
    const instance = makeEditor({
      type: 'doc',
      content: [para(inlineMath('a+b'), text(' trailing'))],
    });
    await convert(instance, 'inline', 'Display');
    expect(countNodes(instance.getJSON(), BLOCK_MATH_NODE)).toBe(1);
    expect(JSON.stringify(instance.getJSON())).toContain(' trailing');
    expectSchemaValid(instance);
  });

  it('converts at the end of a paragraph', async () => {
    const instance = makeEditor({
      type: 'doc',
      content: [para(text('leading '), inlineMath('a+b'))],
    });
    await convert(instance, 'inline', 'Display');
    expect(countNodes(instance.getJSON(), BLOCK_MATH_NODE)).toBe(1);
    expect(JSON.stringify(instance.getJSON())).toContain('leading ');
    expectSchemaValid(instance);
  });

  it('converts an equation that is the only content of its paragraph', async () => {
    const instance = makeEditor({ type: 'doc', content: [para(inlineMath('n!'))] });
    await convert(instance, 'inline', 'Display');
    expect(countNodes(instance.getJSON(), BLOCK_MATH_NODE)).toBe(1);
    expect(countNodes(instance.getJSON(), INLINE_MATH_NODE)).toBe(0);
    expectSchemaValid(instance);
  });

  it('converts inside a list item', async () => {
    const instance = makeEditor({
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            { type: 'listItem', content: [para(text('item '), inlineMath('x'))] },
            { type: 'listItem', content: [para(text('second'))] },
          ],
        },
      ],
    });

    await convert(instance, 'inline', 'Display');
    const serialized = JSON.stringify(instance.getJSON());
    // The other list item is untouched.
    expect(serialized).toContain('second');
    expect(countNodes(instance.getJSON(), 'listItem')).toBe(2);
    expectSchemaValid(instance);
  });

  it('converts only the targeted equation when two sit next to each other', async () => {
    const instance = makeEditor({
      type: 'doc',
      content: [para(inlineMath('first'), inlineMath('second'))],
    });

    await convert(instance, 'inline', 'Display');
    const json = instance.getJSON();

    // One converted, one left alone.
    expect(countNodes(json, BLOCK_MATH_NODE)).toBe(1);
    expect(countNodes(json, INLINE_MATH_NODE)).toBe(1);
    const serialized = JSON.stringify(json);
    expect(serialized).toContain('first');
    expect(serialized).toContain('second');
    expectSchemaValid(instance);
  });
});

describe('display to inline conversion', () => {
  it('converts between surrounding paragraphs without disturbing them', async () => {
    const instance = makeEditor({
      type: 'doc',
      content: [para(text('above')), blockMath('\\sum x'), para(text('below'))],
    });

    await convert(instance, 'block', 'Inline');
    const json = instance.getJSON();

    expect(countNodes(json, INLINE_MATH_NODE)).toBe(1);
    expect(countNodes(json, BLOCK_MATH_NODE)).toBe(0);
    const serialized = JSON.stringify(json);
    expect(serialized).toContain('above');
    expect(serialized).toContain('below');
    expectSchemaValid(instance);
  });

  it('keeps the latex source through a round trip', async () => {
    const instance = makeEditor({ type: 'doc', content: [para(inlineMath('\\alpha_1'))] });

    await convert(instance, 'inline', 'Display');
    expect(plainText(instance)).toContain('\\alpha_1');

    await convert(instance, 'block', 'Inline');
    expect(plainText(instance)).toContain('\\alpha_1');
    expect(countNodes(instance.getJSON(), INLINE_MATH_NODE)).toBe(1);
    expectSchemaValid(instance);
  });
});

describe('history around a conversion', () => {
  it('undo restores the original equation and structure, redo reapplies it', async () => {
    const instance = makeEditor({
      type: 'doc',
      content: [para(text('keep '), inlineMath('x^2'))],
    });
    const before = JSON.stringify(instance.getJSON());

    await convert(instance, 'inline', 'Display');
    expect(countNodes(instance.getJSON(), BLOCK_MATH_NODE)).toBe(1);

    // A conversion is a delete plus an insert. If those landed in separate history steps, one
    // undo would leave the document with neither equation.
    instance.commands.undo();
    await waitFor(() => expect(countNodes(instance.getJSON(), INLINE_MATH_NODE)).toBe(1));
    expect(countNodes(instance.getJSON(), BLOCK_MATH_NODE)).toBe(0);
    expect(JSON.stringify(instance.getJSON())).toContain('keep ');

    instance.commands.redo();
    await waitFor(() => expect(countNodes(instance.getJSON(), BLOCK_MATH_NODE)).toBe(1));
    expect(countNodes(instance.getJSON(), INLINE_MATH_NODE)).toBe(0);

    // And undoing all the way back reaches the original document.
    instance.commands.undo();
    await waitFor(() => expect(JSON.stringify(instance.getJSON())).toBe(before));
  });
});

describe('editing without changing placement', () => {
  it('updates the source of the targeted equation only', async () => {
    const instance = makeEditor({
      type: 'doc',
      content: [para(inlineMath('old'), text(' and '), inlineMath('other'))],
    });
    const { pos } = findMath(instance, INLINE_MATH_NODE);

    render(
      <EquationDialog
        editor={instance}
        open
        onOpenChange={() => {}}
        target={{ mode: 'inline', latex: 'old', pos }}
      />,
    );
    fireEvent.change(screen.getByLabelText('LaTeX'), { target: { value: 'updated' } });
    fireEvent.submit(screen.getByLabelText('LaTeX').closest('form')!);

    await waitFor(() => expect(plainText(instance)).toContain('updated'));
    // The neighbour is untouched, and the edited one is gone.
    expect(plainText(instance)).toContain('other');
    expect(plainText(instance)).not.toContain('old');
    expect(countNodes(instance.getJSON(), INLINE_MATH_NODE)).toBe(2);
    expectSchemaValid(instance);
  });
});
