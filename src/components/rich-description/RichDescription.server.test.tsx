import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect } from 'vitest';

import { RichDescription } from './RichDescription';

/**
 * Deliberately NOT a jsdom test: this file runs in the default node environment, which is what
 * proves the renderer is server-renderable. It uses no browser API and no hooks, so it can be
 * rendered on the server today and could later render its maths there too, keeping the KaTeX
 * bundle away from students.
 */
const doc = (...content: unknown[]) => ({ version: 1, document: { type: 'doc', content } });

describe('RichDescription on the server', () => {
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
    expect(html).toContain('rel="noopener noreferrer nofollow"');
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
