import { describe, it, expect } from 'vitest';
import { MAX_LATEX_LENGTH, validateLatex, isAllowedLatex } from './latex';
import { validateRichDescription } from './schema';

describe('validateLatex', () => {
  it('accepts an expression and trims it', () => {
    expect(validateLatex('  n^2  ')).toEqual({ ok: true, latex: 'n^2' });
  });

  it('refuses an empty or whitespace-only expression', () => {
    expect(validateLatex('').ok).toBe(false);
    expect(validateLatex('   ').ok).toBe(false);
  });

  it('refuses an expression past the length bound and says how long it is', () => {
    const result = validateLatex('x'.repeat(MAX_LATEX_LENGTH + 1));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain(String(MAX_LATEX_LENGTH + 1));
  });

  it('does not judge whether the maths is meaningful (KaTeX reports that)', () => {
    expect(validateLatex('\\frac{').ok).toBe(true);
  });
});

describe('isAllowedLatex', () => {
  it('only accepts strings within the bounds', () => {
    expect(isAllowedLatex('x')).toBe(true);
    expect(isAllowedLatex('')).toBe(false);
    expect(isAllowedLatex(null)).toBe(false);
    expect(isAllowedLatex(42)).toBe(false);
  });
});

describe('stored math nodes', () => {
  const withLatex = (latex: unknown) => ({
    version: 1,
    document: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'inlineMath', attrs: { latex } }] }],
    },
  });

  it('validates a normal equation', () => {
    expect(validateRichDescription(withLatex('n^2')).ok).toBe(true);
  });

  it('rejects a hand-crafted payload with no latex, empty latex, or an oversized expression', () => {
    expect(validateRichDescription(withLatex(undefined)).ok).toBe(false);
    expect(validateRichDescription(withLatex('')).ok).toBe(false);
    expect(validateRichDescription(withLatex('x'.repeat(MAX_LATEX_LENGTH + 1))).ok).toBe(false);
  });
});
