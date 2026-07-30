import { KATEX_PUBLISHED_OPTIONS } from '@/lib/rich-description';

/**
 * Turn stored LaTeX into KaTeX markup for a read surface.
 *
 * Isolated in its own module on purpose. It is the single place KaTeX is called for rendering, and
 * it touches no browser API, so it works on the server as well as in the browser.
 *
 * The options come from `KATEX_PUBLISHED_OPTIONS` rather than being spelled out here, so the
 * editor, this renderer, and the dialog's validation cannot drift apart on `trust` or on the size
 * and expansion limits. Only `displayMode` is decided per call.
 *
 * KaTeX is loaded on DEMAND rather than imported, because it is ~700 KB of JavaScript and most
 * descriptions contain no equations at all. A static import here put it in the chunk graph of
 * every route that renders a description, so every student downloaded a maths typesetter to read
 * a prompt that had no maths in it. `loadMathRenderer` is the one way in; until it resolves,
 * `renderDescriptionMath` reports that it cannot render, and callers show the LaTeX source.
 */

/** The sliver of KaTeX's surface this module uses. Avoids importing its types eagerly. */
type MathRenderer = {
  renderToString: (latex: string, options: Record<string, unknown>) => string;
};

let renderer: MathRenderer | null = null;
let loading: Promise<void> | null = null;

/**
 * Is the renderer in memory? False means `renderDescriptionMath` will decline, NOT that the
 * expression is bad, which is the distinction a caller needs to decide whether to wait.
 */
export function isMathRendererReady(): boolean {
  return renderer !== null;
}

/**
 * Fetch KaTeX, once per process. Every caller shares the same promise, so a page with twenty
 * equations still loads it once.
 *
 * Resolves even on failure: a network error loading the chunk leaves the renderer unavailable and
 * the source text on screen, which is the same degraded state as an unrenderable expression. A
 * failed attempt is forgotten so a later render can retry.
 */
export function loadMathRenderer(): Promise<void> {
  if (renderer) return Promise.resolve();
  loading ??= import('katex')
    .then((module) => {
      renderer = (module.default ?? module) as unknown as MathRenderer;
    })
    .catch(() => {
      loading = null;
    });
  return loading;
}

/**
 * Rendered output, keyed by the exact input that produced it.
 *
 * Rendering is a pure function of (latex, displayMode), and the walker calls it for every equation
 * on every render, so the same handful of expressions are re-rendered constantly while a page is
 * open. Caching is safe here precisely because nothing else varies.
 *
 * Bounded because this module is also loaded server-side, where the process is long-lived and an
 * unbounded map would be a slow leak. Clearing wholesale rather than evicting one entry keeps it
 * simple: the cap is far above any single page's equation count, so a clear is rare and the refill
 * is cheap.
 */
const RENDER_CACHE = new Map<string, string | null>();
const RENDER_CACHE_LIMIT = 500;

/**
 * Render one equation. Returns the KaTeX HTML, or null when it cannot be rendered: either the
 * renderer is not loaded yet, or even KaTeX's own error path failed. Both leave the caller showing
 * the LaTeX source, which is a poor rendering of an equation but a complete one.
 */
export function renderDescriptionMath(latex: string, displayMode: boolean): string | null {
  if (!renderer) return null;

  // The mode is part of the key: the same source renders differently inline and as a block.
  const key = `${displayMode ? 'block' : 'inline'}:${latex}`;
  const cached = RENDER_CACHE.get(key);
  // A cached null is a real result (the render failed), so check presence, not truthiness.
  if (cached !== undefined || RENDER_CACHE.has(key)) return cached ?? null;

  let html: string | null;
  try {
    html = renderer.renderToString(latex, { ...KATEX_PUBLISHED_OPTIONS, displayMode });
  } catch {
    // With throwOnError disabled KaTeX handles bad input itself, so reaching here means something
    // unexpected. Degrade to the source text instead of breaking the page.
    html = null;
  }

  if (RENDER_CACHE.size >= RENDER_CACHE_LIMIT) RENDER_CACHE.clear();
  RENDER_CACHE.set(key, html);
  return html;
}
