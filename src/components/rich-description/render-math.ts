import katex from 'katex';

/**
 * Turn stored LaTeX into KaTeX markup for a read surface.
 *
 * Isolated in its own module on purpose. It is the single place KaTeX is called for rendering,
 * and it touches no browser API, so math rendering can later be moved behind a server-only
 * boundary (keeping the ~270 KB KaTeX bundle away from students) without touching the document
 * walker that calls it.
 *
 * The options match the editor's exactly, which is what keeps a description looking the same
 * while it is being written and after it is published:
 *  - trust: false blocks the commands that emit markup or fetch resources (\href, \url,
 *    \includegraphics, \html*), so rendered output cannot become an injection vector.
 *  - throwOnError: false renders a malformed expression as visible error text instead of
 *    throwing part-way through a page.
 *  - htmlAndMathml emits MathML alongside the visual output, so screen readers read the maths
 *    rather than a pile of styled spans.
 */
const KATEX_OPTIONS = {
  throwOnError: false,
  output: 'htmlAndMathml' as const,
  trust: false,
  strict: 'ignore' as const,
  maxSize: 20,
  maxExpand: 200,
};

/**
 * Rendered output, keyed by the exact input that produced it.
 *
 * Rendering is a pure function of (latex, displayMode), and the walker calls it for every
 * equation on every render, so the same handful of expressions are re-rendered constantly while
 * a page is open. Caching is safe here precisely because nothing else varies.
 *
 * Bounded because this module is also loaded server-side, where the process is long-lived and an
 * unbounded map would be a slow leak. Clearing wholesale rather than evicting one entry keeps it
 * simple: the cap is far above any single page's equation count, so a clear is rare and the
 * refill is cheap.
 */
const RENDER_CACHE = new Map<string, string | null>();
const RENDER_CACHE_LIMIT = 500;

/**
 * Render one equation. Returns the KaTeX HTML, or null when even the error path failed, which
 * lets the caller fall back to showing the LaTeX source as text rather than nothing.
 */
export function renderDescriptionMath(latex: string, displayMode: boolean): string | null {
  // The mode is part of the key: the same source renders differently inline and as a block.
  const key = `${displayMode ? 'block' : 'inline'}:${latex}`;
  const cached = RENDER_CACHE.get(key);
  // A cached null is a real result (the render failed), so check presence, not truthiness.
  if (cached !== undefined || RENDER_CACHE.has(key)) return cached ?? null;

  let html: string | null;
  try {
    html = katex.renderToString(latex, { ...KATEX_OPTIONS, displayMode });
  } catch {
    // With throwOnError disabled KaTeX handles bad input itself, so reaching here means
    // something unexpected. Degrade to the source text instead of breaking the page.
    html = null;
  }

  if (RENDER_CACHE.size >= RENDER_CACHE_LIMIT) RENDER_CACHE.clear();
  RENDER_CACHE.set(key, html);
  return html;
}
