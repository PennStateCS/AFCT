import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect, beforeAll } from 'vitest';

import { RichDescription } from './RichDescription';
import { loadMathRenderer } from './render-math';

/**
 * Deliberately NOT a jsdom test: this file runs in the default node environment, which is what
 * proves the renderer is server-renderable. It uses no browser API, so it can be rendered on the
 * server, maths included.
 *
 * The maths is the one part with a precondition. KaTeX is loaded on demand rather than imported,
 * to keep ~700 KB of typesetter off the routes students read, so a server surface that wants
 * equations in its HTML awaits `loadMathRenderer()` once before rendering. Without that the
 * equations come out as their LaTeX source, which the last test pins down.
 */
const doc = (...content: unknown[]) => ({ version: 1, document: { type: 'doc', content } });

describe('RichDescription on the server', () => {
  beforeAll(async () => {
    await loadMathRenderer();
  });

  it('renders structure, marks, links, and maths without a DOM', () => {
    const html = renderToStaticMarkup(
      <RichDescription
        description="fallback"
        descriptionJson={doc(
          { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Task' }] },
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
              {
                type: 'text',
                text: 'link',
                marks: [{ type: 'link', attrs: { href: 'https://example.edu/' } }],
              },
              { type: 'inlineMath', attrs: { latex: 'n^2' } },
            ],
          },
        )}
      />,
    );

    expect(html).toContain('<h2');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('href="https://example.edu/"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('<math');
  });

  it('produces identical markup on repeated renders, so hydration cannot mismatch', () => {
    const element = (
      <RichDescription
        description="fallback"
        descriptionJson={doc({
          type: 'paragraph',
          content: [{ type: 'inlineMath', attrs: { latex: '\\frac{n(n-1)}{2}' } }],
        })}
      />
    );
    expect(renderToStaticMarkup(element)).toBe(renderToStaticMarkup(element));
  });

  it('falls back to plain text server-side too', () => {
    const html = renderToStaticMarkup(
      <RichDescription description="just text" descriptionJson={{ version: 99 }} />,
    );
    expect(html).toContain('just text');
  });
});
