import StarterKit from '@tiptap/starter-kit';
import TextAlign from '@tiptap/extension-text-align';
import Link from '@tiptap/extension-link';
import { BlockMath, InlineMath } from '@tiptap/extension-mathematics';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { NodeSelection } from '@tiptap/pm/state';
import type { Editor } from '@tiptap/react';
// KaTeX's stylesheet is served from public/katex and linked in the root layout, not imported
// here: a bundler import pulls its 60 font files into the chunk graph of every route that
// renders a description. See scripts/vendor-katex.mjs.
import {
  ALLOWED_TEXT_ALIGN,
  ALLOWED_LINK_PROTOCOLS,
  BLOCK_MATH_NODE,
  INLINE_MATH_NODE,
  isAllowedLinkHref,
  MATH_LATEX_ATTR,
  KATEX_PUBLISHED_OPTIONS,
} from '@/lib/rich-description';

/** Which kind of equation a math node is. */
export type MathMode = 'inline' | 'block';

/** A math node the author clicked, with everything the edit dialog needs. */
export type MathClickTarget = { mode: MathMode; latex: string; pos: number };

export type RichDescriptionExtensionOptions = {
  /** Called when the author clicks an equation, so the caller can open the edit dialog. */
  onMathClick?: (target: MathClickTarget) => void;
};

/**
 * Shared KaTeX render options. Deliberately locked down:
 *  - trust: false blocks the LaTeX commands that can emit markup or fetch resources
 *    (\href, \url, \includegraphics, \html*), so a stored equation cannot become an injection
 *    vector even though it is authored by faculty.
 *  - throwOnError: false renders bad input as visible error text instead of throwing inside a
 *    node view, which would blank the editor.
 *  - maxSize / maxExpand bound how far a single expression can blow up the render.
 *  - htmlAndMathml gives screen readers real MathML alongside the visual HTML.
 */

/**
 * The equation the cursor is currently ON, or null.
 *
 * Both math nodes are ProseMirror atoms, so arrow-keying onto one produces a NodeSelection
 * rather than a text cursor inside it. That is the whole keyboard story for equations: this
 * turns that selection into the same target shape a click produces, so the toolbar can relabel
 * itself and Enter/Space can open the edit dialog without a pointer.
 */
export function selectedMathTarget(editor: Editor | null): MathClickTarget | null {
  if (!editor) return null;
  const { selection } = editor.state;
  if (!(selection instanceof NodeSelection)) return null;
  const { node } = selection;
  if (node.type.name === INLINE_MATH_NODE) {
    return { mode: 'inline', latex: latexOf(node), pos: selection.from };
  }
  if (node.type.name === BLOCK_MATH_NODE) {
    return { mode: 'block', latex: latexOf(node), pos: selection.from };
  }
  return null;
}

/** Read the latex source off a clicked math node. */
function latexOf(node: ProseMirrorNode) {
  const value = node.attrs?.[MATH_LATEX_ATTR];
  return typeof value === 'string' ? value : '';
}

/**
 * The Tiptap extension set for AFCT rich descriptions.
 *
 * This MUST stay in step with the allowlist the validator enforces
 * (`ALLOWED_CONTENT_NODE_TYPES` / `ALLOWED_MARK_TYPES` in `@/lib/rich-description`): an
 * extension enabled here but missing there produces documents that fail validation and
 * silently fall back to plain text.
 *
 * Deliberately disabled:
 *  - strike: not in the supported feature set.
 *
 * A factory rather than a constant because the math nodes need a click handler that opens the
 * caller's dialog. Call it once per editor and keep the result stable (recreating the array
 * would recreate the editor and lose selection and history).
 */
export function createRichDescriptionExtensions({
  onMathClick,
}: RichDescriptionExtensionOptions = {}) {
  return [
    StarterKit.configure({
      strike: false,
      // Link is configured separately below with the AFCT protocol allowlist.
      link: false,
      // Headings below H1 only: the page already owns the H1.
      heading: { levels: [2, 3, 4] },
    }),
    // Links are created only through the toolbar dialog, which validates the URL. This config
    // is the second line of defence:
    //  - protocols/isAllowedUri restrict schemes to the shared allowlist (https, mailto), so
    //    even a paste or an autolink cannot introduce javascript:/data:/http:.
    //  - autolink is off: a faculty member types the URL into the dialog, so nothing is
    //    silently linkified from arbitrary typed text.
    //  - openOnClick is off so clicking a link while editing places the caret instead of
    //    navigating away mid-edit.
    Link.configure({
      autolink: false,
      openOnClick: false,
      linkOnPaste: false,
      protocols: ALLOWED_LINK_PROTOCOLS.map((p) => p.replace(':', '')),
      isAllowedUri: (url: string) => isAllowedLinkHref(url),
      HTMLAttributes: {
        // Rendered links are safe by construction: no window.opener handle, and no referrer
        // leakage to the destination.
        rel: 'noopener noreferrer',
        target: '_blank',
      },
    }),
    // Equations. The two nodes are used directly rather than through the bundled Mathematics
    // extension so each gets its own displayMode and its own click handler.
    //
    // Input rules are removed on purpose. Upstream maps `$$x$$` to INLINE math and `$$$x$$$` to
    // a display block, which inverts the convention every LaTeX author expects and does not
    // match how AFCT writes math into the plain-text description ($x$ inline, $$x$$ display).
    // Equations therefore come from the dialog only, the same rule links follow, and typing
    // dollar signs in prose stays literal text.
    InlineMath.extend({ addInputRules: () => [] }).configure({
      katexOptions: { ...KATEX_PUBLISHED_OPTIONS, displayMode: false },
      onClick: onMathClick
        ? (node, pos) => onMathClick({ mode: 'inline', latex: latexOf(node), pos })
        : undefined,
    }),
    BlockMath.extend({ addInputRules: () => [] }).configure({
      katexOptions: { ...KATEX_PUBLISHED_OPTIONS, displayMode: true },
      onClick: onMathClick
        ? (node, pos) => onMathClick({ mode: 'block', latex: latexOf(node), pos })
        : undefined,
    }),
    // Alignment on paragraphs and headings only. `alignments` is the allowlist the extension
    // itself enforces, and it comes from the same constant the validator uses, so `justify`
    // cannot be produced here or accepted on read. Left is the default and is stored as no
    // attribute at all, keeping existing documents unchanged.
    //
    // Block equations are not in `types`: the upstream node is an atom carrying only `latex`,
    // so it has nowhere to store an alignment. They are centred by .afct-rich-text instead.
    //
    // The upstream extension renders alignment as an inline `style="text-align: …"`. AFCT
    // renders a `data-align` attribute instead (styled by .afct-rich-text in globals.css), so
    // rendered output carries no inline style for a sanitizer to have to reason about. Parsing
    // still accepts the upstream inline style, so pasted/older content keeps working.
    TextAlign.extend({
      addAttributes() {
        return {
          textAlign: {
            default: null,
            parseHTML: (element: HTMLElement) => {
              const value = element.getAttribute('data-align') ?? element.style.textAlign;
              return ALLOWED_TEXT_ALIGN.includes(value as never) ? value : null;
            },
            renderHTML: (attributes: Record<string, unknown>) => {
              const value = attributes.textAlign as string | null;
              if (!value || value === 'left' || !ALLOWED_TEXT_ALIGN.includes(value as never)) {
                return {};
              }
              return { 'data-align': value };
            },
          },
        };
      },
    }).configure({
      types: ['paragraph', 'heading'],
      alignments: [...ALLOWED_TEXT_ALIGN],
      // No defaultAlignment on purpose: with one set, every block would carry an explicit
      // textAlign: 'left'. Leaving it unset keeps left as "no attribute", so plain paragraphs
      // and every pre-existing document stay byte-identical.
    }),
  ];
}
