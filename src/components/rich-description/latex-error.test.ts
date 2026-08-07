import { describe, it, expect } from 'vitest';
import { describeLatexError } from './latex-error';

/**
 * The strings here are real KaTeX output, including the combining-underline caret it appends,
 * so the tidying is exercised against what the library actually throws rather than a paraphrase.
 */
describe('describeLatexError', () => {
  it('names the unknown command and says what to do', () => {
    const out = describeLatexError(
      new Error('KaTeX parse error: Undefined control sequence: \\foo at position 1: \\̲f̲o̲o̲'),
    );
    expect(out.message).toContain('\\foo');
    expect(out.message).toMatch(/spelling/i);
    // KaTeX's own words stay available for the many faculty who read LaTeX fluently.
    expect(out.detail).toBe('Undefined control sequence: \\foo');
  });

  it('explains an unmatched closing brace', () => {
    const out = describeLatexError(
      new Error("KaTeX parse error: Expected 'EOF', got '}' at position 5: x^2}̲"),
    );
    expect(out.message).toContain('}');
    expect(out.message).toMatch(/remove it|matching/i);
  });

  it('explains a missing group', () => {
    const out = describeLatexError(
      new Error("KaTeX parse error: Expected group after '^' at position 2: x^̲"),
    );
    expect(out.message).toMatch(/braces/i);
    expect(out.message).toContain('^');
  });

  it('explains a double superscript', () => {
    const out = describeLatexError(
      new Error('KaTeX parse error: Double superscript at position 4'),
    );
    expect(out.message).toMatch(/two superscripts/i);
  });

  it('explains an expression that expands too far', () => {
    const out = describeLatexError(new Error('Too many expansions: infinite loop detected'));
    expect(out.message).toMatch(/too complex/i);
  });

  it('falls back to an actionable sentence for anything unrecognised', () => {
    const out = describeLatexError(new Error('KaTeX parse error: something entirely new'));
    expect(out.message).toMatch(/mistyped command|brace/i);
    expect(out.detail).toBe('something entirely new');
  });

  it('never surfaces [object Object] for a non-Error throw', () => {
    for (const thrown of [undefined, null, 42, {}, []]) {
      const out = describeLatexError(thrown);
      expect(out.message.length).toBeGreaterThan(0);
      expect(out.message).not.toContain('object Object');
      expect(out.detail).toBeUndefined();
    }
  });

  it('strips the position suffix and caret from the detail', () => {
    const out = describeLatexError(
      new Error("KaTeX parse error: Expected 'EOF', got '}' at position 5: x^2}̲"),
    );
    expect(out.detail).toBe("Expected 'EOF', got '}'");
    expect(out.detail).not.toMatch(/position/);
  });
});
