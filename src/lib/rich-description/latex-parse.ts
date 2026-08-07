import katex from 'katex';

import { KATEX_VALIDATION_OPTIONS } from './katex-options';
import { validateLatex } from './latex';

/**
 * Why the source was refused, so the caller knows whether the message is already fit to show.
 *
 * `policy` failures (empty, too long) are written for the author already. `parse` failures carry
 * KaTeX's own wording, which needs `describeLatexError` before a professor should see it. Losing
 * this distinction meant "Enter a LaTeX expression." was replaced by the generic parse fallback.
 */
export type ParsedLatex =
  { ok: true; latex: string } | { ok: false; error: string; kind: 'policy' | 'parse' };

/**
 * The authoritative check on an equation's source: is it something KaTeX can actually draw?
 *
 * Kept separate from `latex.ts` on purpose. That module is the cheap SOURCE POLICY (trim, empty,
 * length) and imports nothing, so the Zod schema and the read path can use it freely. This one
 * imports KaTeX, so it is only pulled in where a real parse is worth the cost: the dialog's
 * submit handler and the write path.
 *
 * KaTeX itself is isomorphic (the read-only renderer already calls it during server rendering),
 * so this is safe on the server. It does not touch the DOM: `renderToString` builds a string.
 *
 * Why parse rather than pattern-match: there is no way to tell `\frac{1}{2}` from `\frac{1}` by
 * inspection short of reimplementing the parser. Handing it to KaTeX with `throwOnError: true`
 * is the only honest answer, and it uses the same options the published renderer will use, so a
 * source accepted here cannot fail there.
 */
export function parseLatexSource(raw: string): ParsedLatex {
  // Source policy first: it is cheaper, and "too long" is a better message than a parse error.
  const policy = validateLatex(raw);
  if (!policy.ok) return { ok: false, error: policy.error, kind: 'policy' };

  try {
    katex.renderToString(policy.latex, { ...KATEX_VALIDATION_OPTIONS, displayMode: false });
  } catch (cause) {
    return {
      ok: false,
      error: cause instanceof Error ? cause.message : 'This is not valid LaTeX.',
      kind: 'parse',
    };
  }
  return { ok: true, latex: policy.latex };
}

/** Cheap predicate for callers that only need a yes or no. */
export function isParsableLatex(raw: unknown): boolean {
  return typeof raw === 'string' && parseLatexSource(raw).ok;
}
