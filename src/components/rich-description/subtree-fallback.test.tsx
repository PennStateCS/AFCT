/** @vitest-environment jsdom */

import React from 'react';
import { render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { RichDescription } from './RichDescription';
import { MAX_DOCUMENT_DEPTH, MAX_NODE_COUNT, MAX_TEXT_NODE_LENGTH } from '@/lib/rich-description';

const globalWithReact = globalThis as typeof globalThis & { React?: typeof React };
globalWithReact.React = React;

const doc = (...content: unknown[]) => ({ version: 1, document: { type: 'doc', content } });
const para = (...content: unknown[]) => ({ type: 'paragraph', content });
const text = (value: string, marks?: unknown[]) => ({
  type: 'text',
  text: value,
  ...(marks ? { marks } : {}),
});

function renderDoc(descriptionJson: unknown, description: string | null = 'PLAIN FALLBACK') {
  return render(<RichDescription description={description} descriptionJson={descriptionJson} />)
    .container;
}

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  warn.mockRestore();
});

/**
 * The behaviour these lock in: one unrecognised node costs its own formatting, not the whole
 * description. Before this, a single unknown node failed validation for the entire envelope and
 * an assignment prompt collapsed to plain text.
 */
describe('graceful subtree fallback', () => {
  it('renders valid siblings when one node is unsupported', () => {
    const container = renderDoc(
      doc(
        para(text('before')),
        { type: 'callout', attrs: { tone: 'warning' }, content: [para(text('inside'))] },
        para(text('after')),
      ),
    );

    expect(container.textContent).toContain('before');
    expect(container.textContent).toContain('after');
    // Not the emergency fallback: the rich branch rendered.
    expect(container.textContent).not.toContain('PLAIN FALLBACK');
    expect(container.querySelectorAll('p').length).toBeGreaterThanOrEqual(2);
  });

  it('keeps the valid children of an unknown wrapper, dropping only the wrapper', () => {
    const container = renderDoc(
      doc({
        type: 'admonition',
        content: [
          para(text('kept text')),
          {
            type: 'bulletList',
            content: [{ type: 'listItem', content: [para(text('kept item'))] }],
          },
        ],
      }),
    );

    expect(container.textContent).toContain('kept text');
    expect(container.textContent).toContain('kept item');
    // The wrapper itself contributes no element, so nothing unrecognised reaches the DOM.
    expect(container.querySelector('admonition')).toBeNull();
    expect(container.querySelector('li')?.textContent).toBe('kept item');
  });

  it('renders the text of an unknown leaf that has no children', () => {
    const container = renderDoc(doc(para(text('a ')), { type: 'mystery', text: 'orphan text' }));
    expect(container.textContent).toContain('orphan text');
  });

  it('drops an unsafe link mark but keeps the words it wrapped', () => {
    const container = renderDoc(
      doc(
        para(text('click me', [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }])),
        para(text('sibling survives')),
      ),
    );

    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toContain('click me');
    expect(container.textContent).toContain('sibling survives');
    expect(container.textContent).not.toContain('PLAIN FALLBACK');
  });

  it('drops an unknown mark but keeps its text', () => {
    const container = renderDoc(doc(para(text('styled', [{ type: 'blink' }]))));
    expect(container.textContent).toContain('styled');
    expect(container.querySelector('blink')).toBeNull();
  });

  it('ignores an unsupported alignment without discarding the paragraph', () => {
    const container = renderDoc(
      doc({ type: 'paragraph', attrs: { textAlign: 'justify' }, content: [text('aligned')] }),
    );
    const p = container.querySelector('p');
    expect(p?.textContent).toBe('aligned');
    expect(p?.getAttribute('data-align')).toBeNull();
    expect(p?.getAttribute('style')).toBeNull();
  });

  it('shows an unusable equation as its source instead of dropping the paragraph', () => {
    const container = renderDoc(
      doc(para(text('math: '), { type: 'inlineMath', attrs: { latex: '' } }, text(' done'))),
    );
    expect(container.textContent).toContain('math:');
    expect(container.textContent).toContain('done');
  });

  it('clamps an out-of-range heading level rather than emitting an invalid tag', () => {
    const container = renderDoc(
      doc({ type: 'heading', attrs: { level: 9 }, content: [text('heading')] }),
    );
    expect(container.querySelector('h1')).toBeNull();
    // Falls back to the base level rather than producing <h9>.
    expect(container.querySelector('h2')?.textContent).toBe('heading');
  });
});

describe('whole-document rejection still applies', () => {
  it('falls back to plain text for an unsupported version', () => {
    const container = renderDoc({
      version: 99,
      document: { type: 'doc', content: [para(text('x'))] },
    });
    expect(container.textContent).toBe('PLAIN FALLBACK');
  });

  it('falls back when the root is not a doc', () => {
    const container = renderDoc({ version: 1, document: { type: 'paragraph' } });
    expect(container.textContent).toBe('PLAIN FALLBACK');
  });

  it('falls back for junk and missing envelopes', () => {
    for (const junk of [42, 'string', [], true, { nope: 1 }]) {
      expect(renderDoc(junk).textContent).toBe('PLAIN FALLBACK');
    }
  });

  it('enforces the depth limit', () => {
    let node: unknown = text('deep');
    for (let i = 0; i < MAX_DOCUMENT_DEPTH + 5; i += 1)
      node = { type: 'paragraph', content: [node] };
    expect(renderDoc(doc(node)).textContent).toBe('PLAIN FALLBACK');
  });

  it('enforces the node-count limit', () => {
    const many = Array.from({ length: MAX_NODE_COUNT + 10 }, () => ({ type: 'paragraph' }));
    expect(renderDoc(doc(...many)).textContent).toBe('PLAIN FALLBACK');
  });

  it('enforces the text-size limit', () => {
    const huge = 'x'.repeat(MAX_TEXT_NODE_LENGTH + 1);
    expect(renderDoc(doc(para(text(huge)))).textContent).toBe('PLAIN FALLBACK');
  });

  it('renders nothing when a document degrades to nothing and there is no plain text', () => {
    const container = renderDoc(doc({ type: 'mystery' }), null);
    expect(container.textContent).toBe('');
  });
});

/**
 * Parsing used to be memoized in a WeakMap keyed on the descriptionJson object, which assumed
 * nobody ever mutates the parsed JSON in place. Nothing in the codebase enforced that. The cache
 * is gone; these prove a changed value is never served from a stale result.
 */
describe('parsing reflects the current value', () => {
  it('re-parses when the same object is mutated between renders', () => {
    const mutable: { version: number; document: { type: string; content: unknown[] } } = {
      version: 1,
      document: { type: 'doc', content: [para(text('first'))] },
    };

    const view = render(<RichDescription description="PLAIN FALLBACK" descriptionJson={mutable} />);
    expect(view.container.textContent).toContain('first');

    // Same object identity, different content. An identity cache would still show "first".
    mutable.document.content = [para(text('second'))];
    view.rerender(<RichDescription description="PLAIN FALLBACK" descriptionJson={mutable} />);
    expect(view.container.textContent).toContain('second');
    expect(view.container.textContent).not.toContain('first');
  });

  it('re-parses when a mutation turns a valid document invalid', () => {
    const mutable: { version: number; document: unknown } = {
      version: 1,
      document: { type: 'doc', content: [para(text('valid'))] },
    };

    const view = render(<RichDescription description="PLAIN FALLBACK" descriptionJson={mutable} />);
    expect(view.container.textContent).toContain('valid');

    mutable.version = 99;
    view.rerender(<RichDescription description="PLAIN FALLBACK" descriptionJson={mutable} />);
    expect(view.container.textContent).toBe('PLAIN FALLBACK');
  });

  it('renders a replaced object independently of an equal earlier one', () => {
    const first = { version: 1, document: { type: 'doc', content: [para(text('one'))] } };
    const second = { version: 1, document: { type: 'doc', content: [para(text('two'))] } };
    const view = render(<RichDescription descriptionJson={first} />);
    view.rerender(<RichDescription descriptionJson={second} />);
    expect(view.container.textContent).toBe('two');
  });
});
