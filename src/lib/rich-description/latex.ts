/**
 * LaTeX policy for rich-description equations.
 *
 * Only the LaTeX SOURCE is ever stored (in a math node's `latex` attribute). Rendered KaTeX
 * HTML is derived at display time and never persisted or accepted from a browser, so there is
 * no markup to sanitize and a stored document stays portable.
 *
 * Server-safe: no DOM, no KaTeX import. KaTeX itself is only pulled in by the client renderer.
 */

/**
 * Upper bound on a single equation's source. Generous for real coursework (a long multi-line
 * align environment is a few hundred characters) while keeping any one node from becoming a
 * pathological input for the renderer.
 */
export const MAX_LATEX_LENGTH = 2000;

export type LatexResult = { ok: true; latex: string } | { ok: false; error: string };

/**
 * Validate an equation's source before it is stored. Deliberately does NOT try to decide
 * whether the LaTeX is mathematically meaningful: KaTeX reports that far better, and the
 * dialog surfaces its message live. This only enforces the bounds the document must satisfy.
 */
export function validateLatex(raw: string): LatexResult {
  const latex = (raw ?? '').trim();
  if (!latex) return { ok: false, error: 'Enter a LaTeX expression.' };
  if (latex.length > MAX_LATEX_LENGTH) {
    return {
      ok: false,
      error: `An equation can be at most ${MAX_LATEX_LENGTH} characters (this one is ${latex.length}).`,
    };
  }
  return { ok: true, latex };
}

/** Cheap predicate for validating stored documents. */
export function isAllowedLatex(latex: unknown): boolean {
  return typeof latex === 'string' && validateLatex(latex).ok;
}
