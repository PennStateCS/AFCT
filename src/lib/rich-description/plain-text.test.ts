import { describe, it, expect } from 'vitest';
import { plainTextToRichDescription, richDescriptionToPlainText } from './plain-text';
import { validateRichDescription, type RichDescriptionEnvelope } from './schema';

function doc(...content: unknown[]): RichDescriptionEnvelope {
  return { version: 1, document: { type: 'doc', content: content as never } };
}

describe('plainTextToRichDescription', () => {
  it('maps one paragraph per line and stays schema-valid', () => {
    const env = plainTextToRichDescription('hello\nworld');
    expect(env.document.content).toHaveLength(2);
    expect(validateRichDescription(env).ok).toBe(true);
  });

  it('turns blank lines into empty paragraphs', () => {
    const env = plainTextToRichDescription('a\n\nb');
    expect(env.document.content?.map((n) => n.content?.length ?? 0)).toEqual([1, 0, 1]);
  });

  it('handles empty string', () => {
    const env = plainTextToRichDescription('');
    expect(env.document.content).toHaveLength(1);
    expect(validateRichDescription(env).ok).toBe(true);
  });
});

describe('richDescriptionToPlainText', () => {
  it('joins paragraphs with newlines', () => {
    expect(
      richDescriptionToPlainText(
        doc(
          { type: 'paragraph', content: [{ type: 'text', text: 'a' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'b' }] },
        ),
      ),
    ).toBe('a\nb');
  });

  it('keeps heading text and drops marks but keeps their text', () => {
    expect(
      richDescriptionToPlainText(
        doc(
          { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Big' }] },
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'strong', marks: [{ type: 'bold' }] }],
          },
        ),
      ),
    ).toBe('Big\nstrong');
  });

  it('renders bullet and ordered lists readably', () => {
    const bullet = doc({
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }],
        },
        {
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'y' }] }],
        },
      ],
    });
    expect(richDescriptionToPlainText(bullet)).toBe('- x\n- y');

    const ordered = doc({
      type: 'orderedList',
      content: [
        {
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }],
        },
        {
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'y' }] }],
        },
      ],
    });
    expect(richDescriptionToPlainText(ordered)).toBe('1. x\n2. y');
  });

  it('preserves code-block content and inline code text', () => {
    expect(
      richDescriptionToPlainText(
        doc({ type: 'codeBlock', content: [{ type: 'text', text: 'const x = 1;\nreturn x;' }] }),
      ),
    ).toBe('const x = 1;\nreturn x;');
    expect(
      richDescriptionToPlainText(
        doc({
          type: 'paragraph',
          content: [{ type: 'text', text: 'inline', marks: [{ type: 'code' }] }],
        }),
      ),
    ).toBe('inline');
  });

  it('preserves LaTeX source for inline and block math', () => {
    expect(
      richDescriptionToPlainText(
        doc({
          type: 'paragraph',
          content: [
            { type: 'text', text: 'value ' },
            { type: 'inlineMath', attrs: { latex: 'x^2' } },
          ],
        }),
      ),
    ).toBe('value $x^2$');
    expect(
      richDescriptionToPlainText(doc({ type: 'blockMath', attrs: { latex: '\\int_0^1 x' } })),
    ).toBe('$$\\int_0^1 x$$');
  });

  it('handles hard breaks, horizontal rules, blockquotes, and links', () => {
    expect(
      richDescriptionToPlainText(
        doc({
          type: 'paragraph',
          content: [
            { type: 'text', text: 'a' },
            { type: 'hardBreak' },
            { type: 'text', text: 'b' },
          ],
        }),
      ),
    ).toBe('a\nb');
    expect(richDescriptionToPlainText(doc({ type: 'horizontalRule' }))).toBe('---');
    expect(
      richDescriptionToPlainText(
        doc({
          type: 'blockquote',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'quoted' }] }],
        }),
      ),
    ).toBe('quoted');
    expect(
      richDescriptionToPlainText(
        doc({
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'click',
              marks: [{ type: 'link', attrs: { href: 'https://a.test' } }],
            },
          ],
        }),
      ),
    ).toBe('click');
  });

  // The Java client and the compact dashboard preview read only this projection, so a realistic
  // document has to come out readable rather than merely non-empty.
  it('keeps a whole rich description readable for a plain-text client', () => {
    const plain = richDescriptionToPlainText(
      doc(
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Task' }] },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Build a DFA over ' },
            { type: 'inlineMath', attrs: { latex: '\\Sigma = \\{a, b\\}' } },
            { type: 'text', text: ' with ' },
            { type: 'text', text: 'at most', marks: [{ type: 'bold' }] },
            { type: 'text', text: ' five states.' },
          ],
        },
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'accept even a' }] }],
            },
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'reject odd b' }] }],
            },
          ],
        },
        { type: 'blockMath', attrs: { latex: 'L = \\{w : |w| \\bmod 2 = 0\\}' } },
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'see the syllabus',
              marks: [{ type: 'link', attrs: { href: 'https://example.edu/syllabus' } }],
            },
          ],
        },
      ),
    );

    expect(plain).toBe(
      [
        'Task',
        'Build a DFA over $\\Sigma = \\{a, b\\}$ with at most five states.',
        '- accept even a',
        '- reject odd b',
        '$$L = \\{w : |w| \\bmod 2 = 0\\}$$',
        'see the syllabus',
      ].join('\n'),
    );
    // Maths stays recognisable rather than silently disappearing, which is the property the
    // student client depends on.
    expect(plain).toContain('$\\Sigma = \\{a, b\\}$');
    expect(plain).toContain('$$L = \\{w : |w| \\bmod 2 = 0\\}$$');
  });

  it('round-trips plain multi-line text', () => {
    for (const text of ['one line', 'a\nb\nc', 'a\n\nb', '']) {
      expect(richDescriptionToPlainText(plainTextToRichDescription(text))).toBe(text);
    }
  });
});
