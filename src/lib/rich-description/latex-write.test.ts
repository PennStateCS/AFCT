import { describe, it, expect } from 'vitest';
import {
  MAX_LATEX_LENGTH,
  KATEX_SHARED_OPTIONS,
  KATEX_PUBLISHED_OPTIONS,
  KATEX_VALIDATION_OPTIONS,
} from './index';
// From the modules, not the barrel: both reach KaTeX, which is why the barrel does not carry
// them. See the note in index.ts.
import { buildDescriptionWrite, InvalidRichDescriptionError } from './write';
import { parseLatexSource, isParsableLatex } from './latex-parse';

// Shaped the way the editor actually writes it: inline maths sits inside a paragraph, display
// maths stands on its own as a sibling block.
const mathDoc = (latex: string, type: 'inlineMath' | 'blockMath' = 'inlineMath') => ({
  version: 1,
  document: {
    type: 'doc',
    content:
      type === 'inlineMath'
        ? [
            {
              type: 'paragraph',
              content: [
                { type: 'text', text: 'Prove that ' },
                { type, attrs: { latex } },
              ],
            },
          ]
        : [
            { type: 'paragraph', content: [{ type: 'text', text: 'Prove that ' }] },
            { type, attrs: { latex } },
          ],
  },
});

/**
 * The gap this closes: the schema's latex check was non-empty plus length, which cannot tell a
 * complete expression from a truncated one. The UI refused malformed LaTeX, but a request that
 * never went through the UI could store it, and the person who found out would be a student
 * reading red error text in an assignment prompt.
 */
describe('write path rejects LaTeX KaTeX cannot render', () => {
  const malformed = [
    ['unbalanced brace', '\\frac{1'],
    ['unknown command', '\\notarealcommand{x}'],
    ['extra closing brace', 'x^2}'],
    ['double superscript', 'x^2^3'],
    ['incomplete command', '\\sqrt'],
  ] as const;

  it.each(malformed)('refuses %s', (_label, latex) => {
    expect(() => buildDescriptionWrite({ descriptionJson: mathDoc(latex) })).toThrow(
      InvalidRichDescriptionError,
    );
  });

  it('refuses malformed display maths too, not just inline', () => {
    expect(() =>
      buildDescriptionWrite({ descriptionJson: mathDoc('\\frac{1', 'blockMath') }),
    ).toThrow(InvalidRichDescriptionError);
  });

  it('reports which equation failed rather than a bare rejection', () => {
    try {
      buildDescriptionWrite({ descriptionJson: mathDoc('\\frac{1') });
      throw new Error('expected a rejection');
    } catch (cause) {
      expect(cause).toBeInstanceOf(InvalidRichDescriptionError);
      expect((cause as Error).message).toMatch(/equation cannot be rendered/i);
    }
  });

  it('finds an equation nested inside a list item', () => {
    const nested = {
      version: 1,
      document: {
        type: 'doc',
        content: [
          {
            type: 'bulletList',
            content: [
              {
                type: 'listItem',
                content: [
                  {
                    type: 'paragraph',
                    content: [{ type: 'inlineMath', attrs: { latex: '\\frac{1' } }],
                  },
                ],
              },
            ],
          },
        ],
      },
    };
    expect(() => buildDescriptionWrite({ descriptionJson: nested })).toThrow(
      InvalidRichDescriptionError,
    );
  });
});

describe('write path still accepts real coursework', () => {
  const valid = [
    ['fraction', '\\frac{n(n-1)}{2}'],
    ['superscript and subscript', 'x_1^2 + x_2^2'],
    ['greek', '\\delta(q_0, a) = q_1'],
    ['automata notation', '\\Sigma^* \\to Q'],
    ['sets and relations', 'L = \\{a^n b^n : n \\geq 0\\}'],
    ['summation', '\\sum_{i=0}^{n} 2^i = 2^{n+1} - 1'],
    ['aligned display maths', '\\begin{aligned} a &= b \\\\ c &= d \\end{aligned}'],
  ] as const;

  it.each(valid)('accepts %s', (_label, latex) => {
    const out = buildDescriptionWrite({ descriptionJson: mathDoc(latex) });
    expect(out.descriptionFormat).toBe('TIPTAP_JSON');
    // The plain-text projection keeps the source for the Java client.
    expect(out.description).toContain(latex);
  });

  it('accepts a display-only construct in a block equation', () => {
    // `\begin{align}` and `\tag` parse in display mode and throw in inline mode. Validating
    // every node as inline made them unsavable in a block equation, which is where a course
    // would actually use them.
    expect(() =>
      buildDescriptionWrite({
        descriptionJson: mathDoc('\\begin{align} a &= b \\end{align}', 'blockMath'),
      }),
    ).not.toThrow();
  });

  it('still refuses a display-only construct in an inline equation', () => {
    // The mode is honoured both ways: inline is genuinely validated as inline.
    expect(() =>
      buildDescriptionWrite({ descriptionJson: mathDoc('\\tag{1} x=y', 'inlineMath') }),
    ).toThrow(InvalidRichDescriptionError);
  });

  it('accepts a source just under the length cap', () => {
    // Padding with a no-op group keeps it parseable while pushing it near the limit.
    const padding = '{x}'.repeat(Math.floor((MAX_LATEX_LENGTH - 20) / 3));
    const latex = `x${padding}`;
    expect(latex.length).toBeLessThanOrEqual(MAX_LATEX_LENGTH);
    expect(() => buildDescriptionWrite({ descriptionJson: mathDoc(latex) })).not.toThrow();
  });

  it('rejects a source over the length cap before attempting to parse it', () => {
    const tooLong = 'x'.repeat(MAX_LATEX_LENGTH + 1);
    const result = parseLatexSource(tooLong);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/at most/i);
  });

  it('leaves plain-text writes alone', () => {
    const out = buildDescriptionWrite({ description: 'no maths here' });
    expect(out.descriptionFormat).toBe('PLAIN_TEXT');
    expect(out.descriptionJson).toBeNull();
  });
});

describe('parseLatexSource', () => {
  it('trims and returns the normalized source', () => {
    const result = parseLatexSource('  x^2  ');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.latex).toBe('x^2');
  });

  it('treats whitespace-only input as empty', () => {
    const result = parseLatexSource('   ');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/enter a latex expression/i);
  });

  it('rejects runaway expansion', () => {
    // maxExpand caps macro expansion, which is the cheap way to make a render pathological.
    const bomb = '\\def\\a{\\b\\b}\\def\\b{\\c\\c}\\def\\c{\\d\\d}\\def\\d{\\e\\e}\\a';
    expect(isParsableLatex(bomb)).toBe(false);
  });

  it('agrees with itself through the predicate form', () => {
    expect(isParsableLatex('x^2')).toBe(true);
    expect(isParsableLatex('\\frac{1')).toBe(false);
    expect(isParsableLatex(42)).toBe(false);
    expect(isParsableLatex(null)).toBe(false);
  });
});

/**
 * The security settings are the reason these options are shared at all. If a future edit adds an
 * option to one variant and not the other, the preview would start accepting expressions the
 * published renderer treats differently.
 */
describe('KaTeX configuration cannot drift', () => {
  it('keeps trust disabled in every variant', () => {
    expect(KATEX_SHARED_OPTIONS.trust).toBe(false);
    expect(KATEX_PUBLISHED_OPTIONS.trust).toBe(false);
    expect(KATEX_VALIDATION_OPTIONS.trust).toBe(false);
  });

  it('shares every security and resource limit between preview and published', () => {
    const security = ['output', 'trust', 'strict', 'maxSize', 'maxExpand'] as const;
    for (const key of security) {
      expect(KATEX_VALIDATION_OPTIONS[key]).toEqual(KATEX_PUBLISHED_OPTIONS[key]);
    }
  });

  it('differs only in how errors are handled', () => {
    expect(KATEX_PUBLISHED_OPTIONS.throwOnError).toBe(false);
    expect(KATEX_VALIDATION_OPTIONS.throwOnError).toBe(true);

    const differing = (
      Object.keys(KATEX_VALIDATION_OPTIONS) as Array<keyof typeof KATEX_VALIDATION_OPTIONS>
    ).filter((key) => KATEX_VALIDATION_OPTIONS[key] !== KATEX_PUBLISHED_OPTIONS[key]);
    expect(differing).toEqual(['throwOnError']);
  });

  it('emits MathML, so screen readers get real maths', () => {
    expect(KATEX_SHARED_OPTIONS.output).toBe('htmlAndMathml');
  });
});
