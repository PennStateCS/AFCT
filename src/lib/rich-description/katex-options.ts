/**
 * The one place KaTeX is configured.
 *
 * These options were previously copy-pasted into three files: the equation dialog's preview, the
 * Tiptap math nodes, and the read-only renderer. Three copies of a security setting is three
 * chances for one to drift, and the one that matters most is `trust: false`, which is what stops
 * a stored equation from emitting markup or fetching a resource through `\href`, `\url`,
 * `\includegraphics`, or the `\html*` family.
 *
 * `displayMode` is deliberately NOT here. It is the one option that genuinely differs per call,
 * because it depends on whether the equation is inline or on its own line.
 */

/** Security and resource limits. Identical everywhere, by construction. */
export const KATEX_SHARED_OPTIONS = {
  /** Screen readers get real MathML alongside the visual output. */
  output: 'htmlAndMathml',
  /** Blocks the commands that can emit markup or fetch resources. Never turn this on. */
  trust: false,
  /** Unicode and other warnings are not worth failing an equation over. */
  strict: 'ignore',
  /** Bounds how large a single expression can render. */
  maxSize: 20,
  /** Bounds macro expansion, which is the cheap way to make a render pathological. */
  maxExpand: 200,
} as const;

/**
 * Rendering an equation that is already stored, in the editor or on a read surface.
 *
 * `throwOnError: false` because a bad expression must degrade to visible error text rather than
 * throwing part-way through a page or blanking the editor.
 */
export const KATEX_PUBLISHED_OPTIONS = {
  ...KATEX_SHARED_OPTIONS,
  throwOnError: false,
} as const;

/**
 * Deciding whether an equation is acceptable at all, in the dialog preview and in the write-path
 * validator.
 *
 * `throwOnError: true` because here the exception IS the answer: it is how we learn the source
 * is unusable, and its message is what the author is shown.
 */
export const KATEX_VALIDATION_OPTIONS = {
  ...KATEX_SHARED_OPTIONS,
  throwOnError: true,
} as const;
