/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { Editor } from '@tiptap/core';

import { EquationDialog } from './EquationDialog';
import { RichDescription } from './RichDescription';
import { createRichDescriptionExtensions } from './extensions';
import { loadMathRenderer } from './render-math';
import {
  BLOCK_MATH_NODE,
  INLINE_MATH_NODE,
  RICH_DESCRIPTION_VERSION,
} from '@/lib/rich-description';

const globalWithReact = globalThis as typeof globalThis & { React?: typeof React };
globalWithReact.React = React;

/**
 * The same equation is drawn by three different pieces of code: the dialog's live preview while
 * the author types, the Tiptap node view inside the editor, and the read-only renderer students
 * see. Each calls KaTeX itself, and the preview uses a different option set from the other two
 * (it throws on a bad expression so the author gets the message; the other two must degrade
 * instead of blanking a page).
 *
 * That is three chances to drift. The failure it produces is the worst kind for this project: an
 * author writes an equation, sees it render correctly, saves, and a student sees something else.
 * No test compared the surfaces, so this walks a valid expression from each class we expect in
 * coursework through all three and asserts the MathML matches exactly.
 *
 * MathML rather than the visual span tree because MathML is what the expression MEANS, and it is
 * what a screen reader reads. Two renderings that agree on it agree on the maths.
 */

let editors: Editor[] = [];
afterEach(() => {
  for (const instance of editors) instance.destroy();
  editors = [];
  document.body.innerHTML = '';
});

function makeEditor(content: unknown): Editor {
  const element = document.createElement('div');
  document.body.appendChild(element);
  const instance = new Editor({
    element,
    extensions: createRichDescriptionExtensions(),
    content: content as never,
  });
  editors.push(instance);
  return instance;
}

/**
 * The `<math>` subtree, or a clear failure. Returning the markup rather than a boolean means a
 * mismatch shows both renderings in the diff.
 */
function mathML(container: HTMLElement, surface: string): string {
  const node = container.querySelector('math');
  if (!node) throw new Error(`${surface} produced no MathML`);
  return node.outerHTML;
}

/** What the author sees while typing, straight out of the dialog's preview effect. */
async function previewMathML(latex: string, display: boolean): Promise<string> {
  const instance = makeEditor({ type: 'doc', content: [{ type: 'paragraph' }] });
  const view = render(
    <EquationDialog editor={instance} open onOpenChange={() => {}} target={null} />,
  );

  if (display) fireEvent.click(await screen.findByRole('radio', { name: 'Display' }));
  fireEvent.change(await screen.findByLabelText('LaTeX'), { target: { value: latex } });

  const preview = await screen.findByRole('region', { name: 'Preview' });
  await waitFor(() => expect(preview.querySelector('math')).not.toBeNull());
  const markup = mathML(preview, 'the dialog preview');
  view.unmount();
  return markup;
}

/** What the author sees in the document itself, drawn by the Tiptap node view. */
async function editorMathML(latex: string, display: boolean): Promise<string> {
  const node = display
    ? { type: BLOCK_MATH_NODE, attrs: { latex } }
    : { type: 'paragraph', content: [{ type: INLINE_MATH_NODE, attrs: { latex } }] };
  const instance = makeEditor({ type: 'doc', content: [node] });

  const dom = instance.view.dom as HTMLElement;
  await waitFor(() => expect(dom.querySelector('math')).not.toBeNull());
  return mathML(dom, 'the editor');
}

/** What a student sees on a read surface. */
async function publishedMathML(latex: string, display: boolean): Promise<string> {
  const node = display
    ? { type: BLOCK_MATH_NODE, attrs: { latex } }
    : { type: 'paragraph', content: [{ type: INLINE_MATH_NODE, attrs: { latex } }] };
  const { container } = render(
    <RichDescription
      description="fallback"
      descriptionJson={{
        version: RICH_DESCRIPTION_VERSION,
        document: { type: 'doc', content: [node] },
      }}
    />,
  );

  await waitFor(() => expect(container.querySelector('math')).not.toBeNull());
  return mathML(container, 'the read surface');
}

/**
 * One expression per class of thing this course material actually contains. Automata notation is
 * here because it is the whole point of the tool: transition functions, state sets, and the empty
 * string turn up in nearly every problem.
 */
const EXPRESSIONS: { name: string; latex: string }[] = [
  { name: 'a fraction', latex: '\\frac{n(n-1)}{2}' },
  { name: 'superscripts and subscripts', latex: 'a^n b_i^{2k}' },
  { name: 'greek letters', latex: '\\delta(q_0, \\varepsilon) = \\lambda' },
  { name: 'sets and relations', latex: 'L = \\{ w \\in \\Sigma^* \\mid |w| \\leq 3 \\}' },
  { name: 'a summation', latex: '\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}' },
  { name: 'a square root', latex: '\\sqrt{n^2 + 1}' },
  { name: 'automata transitions', latex: '\\delta: Q \\times \\Sigma \\rightarrow 2^Q' },
];

describe('the same equation renders identically on all three surfaces', () => {
  beforeAll(async () => {
    // The read surface fetches KaTeX on demand. Load it up front so a comparison never races the
    // fallback-to-source state, which has its own coverage in description-math.test.
    await loadMathRenderer();
  });

  for (const { name, latex } of EXPRESSIONS) {
    it(`agrees on ${name}`, async () => {
      const preview = await previewMathML(latex, false);
      const inEditor = await editorMathML(latex, false);
      const published = await publishedMathML(latex, false);

      expect(inEditor).toBe(preview);
      expect(published).toBe(preview);
      // Guards the comparison itself: three identical empty renderings would otherwise pass.
      expect(published.length).toBeGreaterThan(50);
    });
  }

  it('agrees on a display equation, and marks it as display', async () => {
    const latex = '\\sum_{i=1}^{n} i';
    const preview = await previewMathML(latex, true);
    const inEditor = await editorMathML(latex, true);
    const published = await publishedMathML(latex, true);

    expect(inEditor).toBe(preview);
    expect(published).toBe(preview);
    // display="block" is the difference the mode is supposed to make, so a run where every
    // surface silently fell back to inline would not pass as agreement.
    expect(published).toContain('display="block"');
  });

  it('distinguishes inline from display, so the comparison is not blind to the mode', async () => {
    const latex = '\\sum_{i=1}^{n} i';

    expect(await publishedMathML(latex, true)).not.toBe(await publishedMathML(latex, false));
  });
});
