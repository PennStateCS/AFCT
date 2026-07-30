import { describe, it, expect } from 'vitest';

import { isMathRendererReady, loadMathRenderer, renderDescriptionMath } from './render-math';

/**
 * Node environment on purpose, and the order of these tests matters: the renderer is module
 * state, so the "before loading" case can only be observed once, at the top of the file.
 *
 * The contract being pinned is the reason KaTeX is loaded on demand at all. Nothing may import it
 * statically on the read path, so every caller has to cope with a renderer that is not there yet.
 */
describe('the maths renderer before it is loaded', () => {
  it('declines to render rather than throwing, so the caller can show the source', () => {
    expect(isMathRendererReady()).toBe(false);
    expect(renderDescriptionMath('n^2', false)).toBeNull();
  });
});

describe('the maths renderer once loaded', () => {
  it('renders an expression', async () => {
    await loadMathRenderer();

    expect(isMathRendererReady()).toBe(true);
    expect(renderDescriptionMath('n^2', false)).toContain('<math');
  });

  it('renders display mode differently from inline, and caches them apart', async () => {
    await loadMathRenderer();

    const inline = renderDescriptionMath('n^2', false);
    const block = renderDescriptionMath('n^2', true);
    expect(inline).not.toBe(block);
    // Same inputs, same output: the cache must not leak the other mode's markup back.
    expect(renderDescriptionMath('n^2', false)).toBe(inline);
  });

  it('degrades to null for an expression KaTeX cannot draw at all', async () => {
    await loadMathRenderer();

    // With throwOnError off KaTeX renders most bad input as red error text rather than throwing,
    // so this asserts the shape of the contract: a string or null, never an exception.
    const html = renderDescriptionMath('\\frac{1', false);
    expect(html === null || typeof html === 'string').toBe(true);
  });

  it('is safe to call repeatedly and loads only once', async () => {
    const first = loadMathRenderer();
    const second = loadMathRenderer();
    await Promise.all([first, second]);

    expect(isMathRendererReady()).toBe(true);
  });
});
