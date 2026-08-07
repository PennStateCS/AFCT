/**
 * Turn a KaTeX parse error into something a professor can act on.
 *
 * KaTeX reports failures in its own vocabulary, for example:
 *
 *   KaTeX parse error: Undefined control sequence: \foo at position 1: \̲f̲o̲o̲
 *   KaTeX parse error: Expected 'EOF', got '}' at position 5: x^2}̲
 *
 * Accurate, but it names the parser's internal expectation rather than the fix, which is the
 * opposite of how AFCT is supposed to talk to the people running courses.
 *
 * The detail is kept rather than thrown away. These are computing-theory faculty: many write
 * LaTeX fluently and the original message is genuinely the fastest route to the problem for
 * them. So the dialog leads with the plain sentence and offers KaTeX's own words underneath.
 */

export type LatexErrorText = {
  /** Plain-language sentence that says what to do. Always present. */
  message: string;
  /** KaTeX's own wording, tidied. Absent when it adds nothing over the message. */
  detail?: string;
};

/** Strip the prefix, the position, and the combining-underline caret KaTeX appends. */
function tidy(raw: string): string {
  return raw
    .replace(/^KaTeX parse error:\s*/, '')
    .replace(/\s*at position \d+.*$/s, '')
    .replace(/[̲̳]/g, '')
    .trim();
}

/**
 * Ordered most specific first. Each entry maps a KaTeX failure to the action that fixes it.
 * Anything unmatched falls through to a generic sentence naming the two usual causes.
 */
const RULES: Array<{ test: RegExp; message: (match: RegExpMatchArray) => string }> = [
  {
    test: /Undefined control sequence:?\s*(\\[A-Za-z@]+)/,
    message: (m) =>
      `The command ${m[1]} is not one AFCT can draw. Check the spelling, or use a different command.`,
  },
  {
    test: /Expected 'EOF', got '(.+?)'/,
    message: (m) =>
      `There is an extra ${m[1]} with nothing to match it. Remove it, or add the opening part it belongs to.`,
  },
  {
    test: /Expected group after '(.+?)'/,
    message: (m) => `${m[1]} needs something after it. Put the value in braces, for example x^{2}.`,
  },
  {
    test: /Double (superscript|subscript)/,
    message: (m) =>
      `This has two ${m[1]}s in a row. Combine them into one, for example x^{2n} rather than x^2^n.`,
  },
  {
    test: /Can't use function '(.+?)' in math mode/,
    message: (m) =>
      `${m[1]} cannot be used inside an equation. Remove it and write the maths on its own.`,
  },
  {
    test: /Unexpected end of input|Expected '(.+?)', got 'EOF'/,
    message: () =>
      'The equation stops early. Something opened here was never closed, usually a brace.',
  },
  {
    test: /maxExpand|Too many expansions|infinite loop/i,
    message: () => 'This equation is too complex to draw. Try splitting it into two shorter ones.',
  },
  {
    test: /maxSize/i,
    message: () =>
      'Something in this equation is too large to draw. Reduce the size and try again.',
  },
];

/**
 * Build the text shown under the equation field.
 *
 * `cause` is whatever the render threw, so it is deliberately typed loosely: a non-Error value
 * still has to produce a usable sentence rather than "[object Object]".
 */
export function describeLatexError(cause: unknown): LatexErrorText {
  const raw = cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : '';
  const detail = tidy(raw);

  for (const rule of RULES) {
    const match = raw.match(rule.test);
    if (match) {
      const message = rule.message(match);
      // Suppress the detail when it would just restate the sentence.
      return detail && detail.toLowerCase() !== message.toLowerCase()
        ? { message, detail }
        : { message };
    }
  }

  return {
    message:
      'This is not a complete equation yet. Check for a mistyped command or a brace that was never closed.',
    ...(detail ? { detail } : {}),
  };
}
