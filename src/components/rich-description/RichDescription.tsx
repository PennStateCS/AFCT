import * as React from 'react';

import { cn } from '@/lib/utils';
import {
  ALLOWED_HEADING_LEVELS,
  ALLOWED_TEXT_ALIGN,
  BLOCK_MATH_NODE,
  INLINE_MATH_NODE,
  MATH_LATEX_ATTR,
  describeLink,
  isAllowedLatex,
  parseRichDescriptionForRender,
  type TiptapMark,
  type TiptapNode,
} from '@/lib/rich-description';
import { DescriptionMath } from './DescriptionMath';
import { RichDescriptionBoundary } from './RichDescriptionBoundary';
// KaTeX's stylesheet is served from public/katex and linked in the root layout, not imported
// here: a bundler import pulls its 60 font files into the chunk graph of every route that
// renders a description. See scripts/vendor-katex.mjs.

/** Smallest and largest heading a description may emit. H1 always belongs to the page. */
export const MIN_HEADING_LEVEL = 2;
export const MAX_HEADING_LEVEL = 6;

export type RichDescriptionProps = {
  /** The stored plain text. Used as-is when there is no usable rich document. */
  description?: string | null;
  /** The stored rich document, straight off the DTO. Unknown on purpose; it is validated here. */
  descriptionJson?: unknown;
  /** Tightens vertical rhythm for cards, list rows, and problem headers. */
  compact?: boolean;
  /**
   * The heading level the description's TOP-most heading should render as.
   *
   * Authored headings are H2 to H4, written as if the description owned the page. Real surfaces
   * do not all sit at the same depth: a description inside a dialog that already has an H2 title
   * needs to start at H3 or the outline reads as two peers. This shifts the whole range while
   * keeping the relative hierarchy the author wrote, and clamps to H2..H6 so a description can
   * never emit an H1 or an invalid tag.
   *
   * Defaults to 2, which is the pre-existing behaviour for every call site that does not set it.
   */
  headingBaseLevel?: number;
  className?: string;
};

/** Everything the walker needs that is not the node itself. */
type RenderOptions = { headingBaseLevel: number };

/**
 * Read-only renderer for a stored rich description.
 *
 * A plain React walker over the parsed Tiptap JSON rather than a second editor: read pages get
 * no ProseMirror, the output is server-renderable, and it reuses the same `.afct-rich-text`
 * styles the editor uses so authored and published content match.
 *
 * Failure is graded, because losing a whole assignment prompt to one unrecognised node is a much
 * worse outcome than losing the node:
 *
 *  1. The document is rejected outright only when there is nothing safe to show at all: a
 *     missing or malformed envelope, an unsupported `version`, a root that is not a `doc`, or a
 *     document past the depth, node-count, or text-size limits. Then the plain-text
 *     `description` renders instead, which still carries every word because it is derived from
 *     the rich document on save.
 *  2. A node this build does not recognise keeps its children, dropping only the wrapper. If it
 *     has no renderable children but does carry text, that text is rendered.
 *  3. A mark or attribute that fails the shared safety policy (an href outside the protocol
 *     allowlist, an out-of-range heading level, an unsupported alignment) is dropped while the
 *     content it wrapped survives.
 *  4. An equation whose source fails the latex policy shows its source as inline code rather
 *     than disappearing.
 *
 * The safety rules did not move out of the way to make this possible. `parseRichDescriptionForRender`
 * checks structure and the size limits; every content decision below re-checks the same shared
 * predicates the write-time validator uses (`isAllowedLinkHref` via `describeLink`,
 * `isAllowedLatex`, `ALLOWED_HEADING_LEVELS`, `ALLOWED_TEXT_ALIGN`). Nothing unrecognised is
 * ever emitted as an element or an attribute, so an unknown node cannot introduce markup.
 */
export function RichDescription({
  description,
  descriptionJson,
  compact = false,
  headingBaseLevel = MIN_HEADING_LEVEL,
  className,
}: RichDescriptionProps) {
  // Parsing is a Zod pass plus a bounded walk over a document that is at most a few hundred
  // nodes. It was memoized on object identity for a while; that was removed because the saving
  // was not measurable and an identity cache quietly assumes nobody ever mutates the parsed
  // JSON in place, which is an invariant no type in this codebase enforces.
  const result = descriptionJson == null ? null : parseRichDescriptionForRender(descriptionJson);
  const plain = <PlainDescription text={description} compact={compact} className={className} />;

  if (!result?.ok) {
    if (result) {
      warnFallback(`rich description failed validation (${result.error}); showing plain text`);
    }
    return plain;
  }

  const content = result.envelope.document.content ?? [];
  if (content.length === 0) return plain;

  const options: RenderOptions = {
    headingBaseLevel: clampHeadingLevel(headingBaseLevel),
  };

  // Every node degraded to nothing (for example a document of nothing but unknown empty
  // wrappers). Showing an empty box would look like the description had been lost, so fall back
  // to the plain text, which still holds the words.
  if (content.every((node) => isEmptyNode(node))) return plain;

  const rendered = content.map((node, index) => (
    <React.Fragment key={index}>{renderNode(node, index, options)}</React.Fragment>
  ));

  return (
    <RichDescriptionBoundary fallback={plain}>
      <div className={cn('afct-rich-text', compact && 'afct-rich-text--compact', className)}>
        {rendered}
      </div>
    </RichDescriptionBoundary>
  );
}

/** Would this node contribute nothing at all, whatever it is? */
function isEmptyNode(node: TiptapNode): boolean {
  if (KNOWN_NODE_TYPES.has(node.type)) return false;
  if (typeof node.text === 'string' && node.text.length > 0) return false;
  return (node.content ?? []).every(isEmptyNode);
}

/** Node types this build renders as an element. Anything else is unwrapped. */
const KNOWN_NODE_TYPES = new Set<string>([
  'text',
  'paragraph',
  'heading',
  'bulletList',
  'orderedList',
  'listItem',
  'blockquote',
  'codeBlock',
  'horizontalRule',
  'hardBreak',
  INLINE_MATH_NODE,
  BLOCK_MATH_NODE,
]);

/** Keep a heading inside H2..H6, so a description never competes with the page's H1. */
function clampHeadingLevel(level: number): number {
  if (!Number.isFinite(level)) return MIN_HEADING_LEVEL;
  return Math.min(Math.max(Math.round(level), MIN_HEADING_LEVEL), MAX_HEADING_LEVEL);
}

/** The pre-rich rendering: plain text with newlines preserved. */
function PlainDescription({
  text,
  compact,
  className,
}: {
  text?: string | null;
  compact: boolean;
  className?: string;
}) {
  if (!text) return null;
  return (
    <div
      className={cn(
        'afct-rich-text break-words whitespace-pre-wrap',
        compact && 'afct-rich-text--compact',
        className,
      )}
    >
      {text}
    </div>
  );
}

/**
 * Everything a subtree contributes as text. Math keeps the same delimiters the plain-text
 * projection uses ($ inline, $$ display) so a degraded subtree reads the way the Java client
 * sees it.
 */
function textOf(node: TiptapNode): string {
  if (node.type === 'text') return node.text ?? '';
  if (node.type === INLINE_MATH_NODE) return `$${String(node.attrs?.[MATH_LATEX_ATTR] ?? '')}$`;
  if (node.type === BLOCK_MATH_NODE) return `$$${String(node.attrs?.[MATH_LATEX_ATTR] ?? '')}$$`;
  const own = typeof node.text === 'string' ? node.text : '';
  return own + (node.content ?? []).map(textOf).join('');
}

/** Alignment, but only a value the shared allowlist recognises. Left is the absence of one. */
function alignOf(node: TiptapNode): string | undefined {
  const align = node.attrs?.textAlign;
  if (typeof align !== 'string' || align === 'left') return undefined;
  return (ALLOWED_TEXT_ALIGN as readonly string[]).includes(align) ? align : undefined;
}

/**
 * Every list of children goes through a keyed Fragment. renderNode keys the element it creates
 * itself, but a text node carrying marks is wrapped by applyMark, whose outermost element
 * renderNode never sees and so cannot key. Wrapping here covers all node types uniformly.
 */
function renderChildren(node: TiptapNode, options: RenderOptions): React.ReactNode[] {
  return (node.content ?? []).map((child, index) => (
    <React.Fragment key={index}>{renderNode(child, index, options)}</React.Fragment>
  ));
}

function renderNode(node: TiptapNode, key: React.Key, options: RenderOptions): React.ReactNode {
  switch (node.type) {
    case 'text':
      return renderText(node, key);

    case 'paragraph':
      return (
        <p key={key} data-align={alignOf(node)}>
          {renderChildren(node, options)}
        </p>
      );

    case 'heading': {
      // Authored levels are H2..H4 and are written as if the description owned the page. Shift
      // them by the surface's base level so the outline nests correctly wherever it is used,
      // then clamp so the result is always a real heading tag and never an H1.
      const authored =
        typeof node.attrs?.level === 'number' &&
        (ALLOWED_HEADING_LEVELS as readonly number[]).includes(node.attrs.level)
          ? node.attrs.level
          : ALLOWED_HEADING_LEVELS[0];
      const offset = authored - ALLOWED_HEADING_LEVELS[0];
      const level = clampHeadingLevel(options.headingBaseLevel + offset);
      const Tag = `h${level}` as 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
      return (
        <Tag key={key} data-align={alignOf(node)}>
          {renderChildren(node, options)}
        </Tag>
      );
    }

    case 'bulletList':
      return <ul key={key}>{renderChildren(node, options)}</ul>;
    case 'orderedList':
      return <ol key={key}>{renderChildren(node, options)}</ol>;
    case 'listItem':
      return <li key={key}>{renderChildren(node, options)}</li>;
    case 'blockquote':
      return <blockquote key={key}>{renderChildren(node, options)}</blockquote>;
    case 'codeBlock':
      return (
        <pre key={key}>
          <code>{textOf(node)}</code>
        </pre>
      );
    case 'horizontalRule':
      return <hr key={key} />;
    case 'hardBreak':
      return <br key={key} />;

    case INLINE_MATH_NODE:
    case BLOCK_MATH_NODE:
      return renderMath(node, key);

    default: {
      // A node this build does not know, most likely written by a newer AFCT. Keep what it
      // wrapped and drop only the wrapper, so one unrecognised node costs its own formatting
      // rather than the whole description. No element and no attribute is emitted for it, so an
      // unknown type cannot introduce markup.
      warnFallback(
        `rich description contains unsupported node "${node.type}"; keeping its content`,
      );
      const children = renderChildren(node, options);
      if (children.length > 0) return <React.Fragment key={key}>{children}</React.Fragment>;
      // No children to keep. If it carries text of its own, that is still worth showing.
      const text = textOf(node);
      return text ? <React.Fragment key={key}>{text}</React.Fragment> : null;
    }
  }
}

function renderText(node: TiptapNode, key: React.Key): React.ReactNode {
  const text = node.text ?? '';
  if (!text) return null;

  // Marks apply outermost-first, so wrap in reverse to keep the stored nesting order.
  return (node.marks ?? []).reduceRight<React.ReactNode>(
    (inner, mark) => applyMark(mark, inner),
    <React.Fragment key={key}>{text}</React.Fragment>,
  );
}

function applyMark(mark: TiptapMark, children: React.ReactNode): React.ReactNode {
  switch (mark.type) {
    case 'bold':
      return <strong>{children}</strong>;
    case 'italic':
      return <em>{children}</em>;
    case 'underline':
      return <u>{children}</u>;
    case 'code':
      return <code>{children}</code>;
    case 'link': {
      // An href the shared policy rejects loses its link, never its text.
      const link = describeLink(mark.attrs?.href);
      if (!link) {
        warnFallback('rich description contains a link with an unsupported href; keeping its text');
        return <>{children}</>;
      }
      return (
        <a href={link.href} target={link.target} rel={link.rel}>
          {children}
        </a>
      );
    }
    default:
      // Unknown mark: keep the text, drop the styling. Emitting anything based on an
      // unrecognised mark type is what a sanitizer bypass would look like.
      return <>{children}</>;
  }
}

function renderMath(node: TiptapNode, key: React.Key): React.ReactNode {
  const latex = node.attrs?.[MATH_LATEX_ATTR];
  const displayMode = node.type === BLOCK_MATH_NODE;

  // A math node whose source fails the shared policy shows its source as text rather than
  // vanishing, so the author can see what needs fixing.
  if (!isAllowedLatex(latex)) {
    warnFallback('rich description contains an unusable equation; showing its source');
    return <code key={key}>{String(latex ?? '')}</code>;
  }

  return <DescriptionMath key={key} latex={latex as string} displayMode={displayMode} />;
}

/**
 * Surface fallbacks while developing and in tests, stay quiet in production. A malformed
 * description is a content problem for whoever wrote it, not an operational event, and the
 * project has no structured client logger to route it to.
 */
function warnFallback(message: string): void {
  if (process.env.NODE_ENV === 'production') return;
  console.warn(`[rich-description] ${message}`);
}

export default RichDescription;
