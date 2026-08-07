/** @vitest-environment jsdom */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeAll } from 'vitest';

import { RichDescription } from './RichDescription';
import { loadMathRenderer } from './render-math';
import { MAX_NODE_COUNT, type TiptapNode } from '@/lib/rich-description';

const globalWithReact = globalThis as typeof globalThis & { React?: typeof React };
globalWithReact.React = React;

/** Wrap nodes in a valid envelope. */
const doc = (...content: unknown[]) => ({
  version: 1,
  document: { type: 'doc', content },
});
const para = (...content: unknown[]) => ({ type: 'paragraph', content });
const text = (value: string, marks?: unknown[]) => ({
  type: 'text',
  text: value,
  ...(marks ? { marks } : {}),
});

function renderDoc(descriptionJson: unknown, description = 'plain fallback') {
  const { container } = render(
    <RichDescription description={description} descriptionJson={descriptionJson} />,
  );
  return container;
}

describe('RichDescription: supported nodes', () => {
  it('renders paragraphs, headings, rules, and hard breaks', () => {
    const container = renderDoc(
      doc(
        { type: 'heading', attrs: { level: 2 }, content: [text('A heading')] },
        { type: 'heading', attrs: { level: 3 }, content: [text('Sub')] },
        para(text('First'), { type: 'hardBreak' }, text('Second')),
        { type: 'horizontalRule' },
      ),
    );
    expect(container.querySelector('h2')?.textContent).toBe('A heading');
    expect(container.querySelector('h3')?.textContent).toBe('Sub');
    expect(container.querySelector('br')).not.toBeNull();
    expect(container.querySelector('hr')).not.toBeNull();
  });

  it('renders blockquotes and code blocks', () => {
    const container = renderDoc(
      doc(
        { type: 'blockquote', content: [para(text('quoted'))] },
        { type: 'codeBlock', content: [text('const x = 1;')] },
      ),
    );
    expect(container.querySelector('blockquote')?.textContent).toBe('quoted');
    expect(container.querySelector('pre code')?.textContent).toBe('const x = 1;');
  });

  it('renders nested ordered and unordered lists', () => {
    const container = renderDoc(
      doc({
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [
              para(text('outer')),
              {
                type: 'orderedList',
                content: [{ type: 'listItem', content: [para(text('inner'))] }],
              },
            ],
          },
        ],
      }),
    );
    const outerList = container.querySelector('ul');
    expect(outerList).not.toBeNull();
    expect(outerList?.querySelector('ol li')?.textContent).toBe('inner');
  });
});

describe('RichDescription: marks', () => {
  it('renders every supported mark', () => {
    const container = renderDoc(
      doc(
        para(
          text('b', [{ type: 'bold' }]),
          text('i', [{ type: 'italic' }]),
          text('u', [{ type: 'underline' }]),
          text('c', [{ type: 'code' }]),
        ),
      ),
    );
    expect(container.querySelector('strong')?.textContent).toBe('b');
    expect(container.querySelector('em')?.textContent).toBe('i');
    expect(container.querySelector('u')?.textContent).toBe('u');
    expect(container.querySelector('code')?.textContent).toBe('c');
  });

  it('nests stacked marks without losing the text', () => {
    const container = renderDoc(doc(para(text('both', [{ type: 'bold' }, { type: 'italic' }]))));
    expect(container.querySelector('strong em')?.textContent).toBe('both');
  });
});

describe('RichDescription: alignment', () => {
  it('emits data-align for center and right, and nothing for left', () => {
    const container = renderDoc(
      doc(
        { type: 'paragraph', attrs: { textAlign: 'center' }, content: [text('c')] },
        { type: 'paragraph', attrs: { textAlign: 'right' }, content: [text('r')] },
        { type: 'paragraph', attrs: { textAlign: 'left' }, content: [text('l')] },
      ),
    );
    const paragraphs = container.querySelectorAll('p');
    expect(paragraphs[0].getAttribute('data-align')).toBe('center');
    expect(paragraphs[1].getAttribute('data-align')).toBe('right');
    expect(paragraphs[2].getAttribute('data-align')).toBeNull();
  });

  it('ignores an alignment value outside the shared allowlist', () => {
    const container = renderDoc(
      doc({ type: 'paragraph', attrs: { textAlign: 'justify' }, content: [text('j')] }),
    );
    // 'justify' is not in the allowlist, so the ATTRIBUTE is dropped and the paragraph still
    // renders. The security property is unchanged: no alignment reaches the DOM, and no inline
    // style is ever emitted.
    const paragraph = container.querySelector('p');
    expect(paragraph?.textContent).toBe('j');
    expect(paragraph?.getAttribute('data-align')).toBeNull();
    expect(paragraph?.getAttribute('style')).toBeNull();
  });

  it('never emits an inline style', () => {
    const container = renderDoc(
      doc({ type: 'paragraph', attrs: { textAlign: 'center' }, content: [text('c')] }),
    );
    expect(container.querySelector('p')?.getAttribute('style')).toBeNull();
  });
});

describe('RichDescription: headings', () => {
  it('clamps an out-of-policy level rather than emitting an h1', () => {
    // A level-1 heading fails validation, so it cannot arrive through the envelope. This proves
    // the renderer's own clamp for a document that somehow carries one.
    const container = renderDoc(
      doc({ type: 'heading', attrs: { level: 2 }, content: [text('h')] }),
    );
    expect(container.querySelector('h1')).toBeNull();
    expect(container.querySelector('h2')).not.toBeNull();
  });

  it('clamps an h1 to the base level instead of discarding the document', () => {
    const container = renderDoc(
      doc({ type: 'heading', attrs: { level: 1 }, content: [text('h')] }),
    );
    // The page owns h1, so the renderer never emits one. It clamps to the base level and keeps
    // the heading's text rather than losing the whole description over an out-of-range level.
    expect(container.querySelector('h1')).toBeNull();
    expect(container.querySelector('h2')?.textContent).toBe('h');
  });
});

describe('RichDescription: links', () => {
  it('opens an external https link in a new tab with a safe rel', () => {
    const container = renderDoc(
      doc(para(text('syllabus', [{ type: 'link', attrs: { href: 'https://example.edu/x' } }]))),
    );
    const anchor = container.querySelector('a')!;
    expect(anchor.getAttribute('href')).toBe('https://example.edu/x');
    expect(anchor.getAttribute('target')).toBe('_blank');
    // noopener is the security control here. nofollow was removed: it is an SEO hint, not a
    // security control, and AFCT already sends X-Robots-Tag: noindex, nofollow app-wide.
    expect(anchor.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('leaves a mailto link in the same tab', () => {
    const container = renderDoc(
      doc(para(text('email', [{ type: 'link', attrs: { href: 'mailto:prof@example.edu' } }]))),
    );
    const anchor = container.querySelector('a')!;
    expect(anchor.getAttribute('href')).toBe('mailto:prof@example.edu');
    expect(anchor.getAttribute('target')).toBeNull();
  });

  it('drops an unsafe href but keeps the text it wrapped', () => {
    const container = renderDoc(
      doc(para(text('click', [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }]))),
    );
    // The link is refused (no anchor reaches the DOM at all) while the words survive, instead
    // of one bad href costing the entire description its formatting.
    expect(container.querySelector('a')).toBeNull();
    expect(container.innerHTML).not.toContain('javascript:');
    expect(container.textContent).toContain('click');
  });
});

describe('RichDescription: math', () => {
  // KaTeX is fetched on demand so it stays off the routes students read, which means an equation
  // shows its LaTeX source until the renderer arrives. Load it once up front: these tests are
  // about what a rendered equation looks like, and the waiting is covered in render-math.test.
  beforeAll(async () => {
    await loadMathRenderer();
  });

  it('renders inline math with MathML and the source represented', () => {
    const container = renderDoc(doc(para({ type: 'inlineMath', attrs: { latex: 'n^2' } })));
    const host = container.querySelector('[data-type="inline-math"]')!;
    expect(host.querySelector('math')).not.toBeNull();
    expect(host.textContent).toContain('n');
    expect(host.textContent).toContain('2');
  });

  it('renders display math in its own block, distinct from inline', () => {
    const container = renderDoc(
      doc(para({ type: 'inlineMath', attrs: { latex: 'x' } }), {
        type: 'blockMath',
        attrs: { latex: 'x' },
      }),
    );
    const block = container.querySelector('[data-type="block-math"]')!;
    expect(block.tagName).toBe('DIV');
    expect(container.querySelector('[data-type="inline-math"]')!.tagName).toBe('SPAN');
    // KaTeX marks display mode on its own wrapper, which is the durable difference.
    expect(block.innerHTML).toContain('display');
  });

  it('renders malformed LaTeX safely instead of throwing', () => {
    const container = renderDoc(doc(para({ type: 'inlineMath', attrs: { latex: '\\frac{' } })));
    expect(container.querySelector('[data-type="inline-math"]')).not.toBeNull();
    expect(container.querySelector('script')).toBeNull();
  });

  it('refuses to let an unsafe LaTeX command produce a link or trusted HTML', () => {
    const container = renderDoc(
      doc(para({ type: 'inlineMath', attrs: { latex: '\\href{javascript:alert(1)}{click}' } })),
    );
    // trust: false means \href is not honoured. It renders as KaTeX's error text instead of a
    // link, so there is no anchor and no href attribute anywhere in the output.
    expect(container.querySelector('a')).toBeNull();
    expect(container.querySelector('[href]')).toBeNull();
    expect(container.innerHTML).not.toMatch(/\son[a-z]+=/i);
    // KaTeX does echo the original TeX into a MathML <annotation> element, which is inert text
    // content rather than an executable context, so the raw string appearing there is expected.
    expect(container.querySelector('annotation')?.textContent).toContain('\\href');
  });

  it('refuses \\includegraphics and \\htmlClass too', () => {
    for (const latex of ['\\includegraphics{https://evil.test/x.png}', '\\htmlClass{evil}{x}']) {
      const container = renderDoc(doc(para({ type: 'inlineMath', attrs: { latex } })));
      expect(container.querySelector('img')).toBeNull();
      expect(container.querySelector('.evil')).toBeNull();
    }
  });
});

describe('RichDescription: graded fallback', () => {
  it('falls back to plain text when the JSON is malformed', () => {
    const container = renderDoc({ nope: true });
    expect(container.textContent).toContain('plain fallback');
  });

  it('falls back to plain text for an unsupported document version', () => {
    const container = renderDoc({ version: 99, document: { type: 'doc', content: [] } });
    expect(container.textContent).toContain('plain fallback');
  });

  it('falls back to plain text when there is no rich document at all', () => {
    render(<RichDescription description={'just text'} descriptionJson={null} />);
    expect(screen.getByText('just text')).toBeInTheDocument();
  });

  it('renders nothing when neither form has content', () => {
    const { container } = render(<RichDescription description={null} descriptionJson={null} />);
    expect(container.textContent).toBe('');
  });

  // Validation is whole-document, so a node type the allowlist does not know takes the entire
  // description down to plain text. This is the real behaviour; the walker's own per-node
  // guards are unreachable defense in depth and are deliberately not asserted here, because a
  // test that reaches them would prove nothing about a stored document.
  it('keeps the content around and inside an unknown node type', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { container } = render(
      <RichDescription
        description="plain fallback"
        descriptionJson={{
          version: 1,
          document: {
            type: 'doc',
            content: [para(text('formatted')), { type: 'callout', content: [text('inside')] }],
          },
        }}
      />,
    );

    // The valid sibling renders, and the unknown wrapper contributes its children rather than
    // an element. Full coverage of this behaviour lives in subtree-fallback.test.tsx.
    expect(container.textContent).toContain('formatted');
    expect(container.textContent).toContain('inside');
    expect(container.textContent).not.toContain('plain fallback');
    expect(container.querySelector('callout')).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('unsupported node'));
    warn.mockRestore();
  });

  it('rejects a document that nests too deeply', () => {
    let node: TiptapNode = { type: 'paragraph', content: [{ type: 'text', text: 'deep' }] };
    for (let i = 0; i < 25; i += 1) {
      node = { type: 'blockquote', content: [node] };
    }
    const container = renderDoc(doc(node));
    expect(container.textContent).toContain('plain fallback');
  });

  it('rejects a document with too many nodes', () => {
    const many = Array.from({ length: MAX_NODE_COUNT + 10 }, () => para(text('x')));
    const container = renderDoc(doc(...many));
    expect(container.textContent).toContain('plain fallback');
  });

  it('rejects a text node past the length cap', () => {
    const container = renderDoc(doc(para(text('x'.repeat(20001)))));
    expect(container.textContent).toContain('plain fallback');
  });

  it('rejects structured data smuggled into node attributes', () => {
    const container = renderDoc(
      doc({ type: 'paragraph', attrs: { textAlign: 'center', evil: { a: 1 } }, content: [] }),
    );
    expect(container.textContent).toContain('plain fallback');
  });
});

describe('RichDescription: React correctness', () => {
  it('renders lists of children with keys', () => {
    // The global test setup mocks console.error, which silences React's key warning, so this
    // asserts on the mock's calls directly. Marked text is the case that regressed: applyMark
    // wraps the text node in an element that renderNode never sees and therefore cannot key.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <RichDescription
        description="x"
        descriptionJson={doc(
          para(
            text('bold', [{ type: 'bold' }]),
            text(' and '),
            text('italic', [{ type: 'italic' }]),
          ),
          para(text('link', [{ type: 'link', attrs: { href: 'https://example.edu/' } }])),
          {
            type: 'bulletList',
            content: [
              { type: 'listItem', content: [para(text('one'))] },
              { type: 'listItem', content: [para(text('two'))] },
            ],
          },
        )}
      />,
    );
    const messages = spy.mock.calls.map((call) => String(call[0])).join('\n');
    spy.mockRestore();
    expect(messages).not.toContain('unique "key"');
  });
});

describe('RichDescription: density', () => {
  it('adds the compact modifier only when asked', () => {
    const { container: normal } = render(
      <RichDescription description="x" descriptionJson={doc(para(text('x')))} />,
    );
    expect(normal.firstElementChild?.className).toContain('afct-rich-text');
    expect(normal.firstElementChild?.className).not.toContain('compact');

    const { container: compact } = render(
      <RichDescription description="x" descriptionJson={doc(para(text('x')))} compact />,
    );
    expect(compact.firstElementChild?.className).toContain('afct-rich-text--compact');
  });
});
