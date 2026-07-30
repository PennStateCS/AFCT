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
  validateRichDescription,
  type TiptapMark,
  type TiptapNode,
} from '@/lib/rich-description';
import { renderDescriptionMath } from './render-math';
import { RichDescriptionBoundary } from './RichDescriptionBoundary';
// KaTeX's stylesheet is served from public/katex and linked in the root layout, not imported
// here: a bundler import pulls its 60 font files into the chunk graph of every route that
// renders a description. See scripts/vendor-katex.mjs.

export type RichDescriptionProps = {
  /** The stored plain text. Used as-is when there is no usable rich document. */
  description?: string | null;
  /** The stored rich document, straight off the DTO. Unknown on purpose; it is validated here. */
  descriptionJson?: unknown;
  /** Tightens vertical rhythm for cards, list rows, and problem headers. */
  compact?: boolean;
  className?: string;
};

/**
 * Read-only renderer for a stored rich description.
 *
 * A plain React walker over the validated Tiptap JSON rather than a second editor: read pages
 * get no ProseMirror, the output is server-renderable, and it reuses the same `.afct-rich-text`
 * styles the editor uses so authored and published content match.
 *
 * Fallback behaviour, and what it actually is:
 *
 * `validateRichDescription` accepts or rejects a document as a whole, so in practice there is
 * ONE observable fallback: a missing, malformed, unsupported-version, or otherwise invalid
 * document renders the plain-text `description` instead. Because the plain text is derived from
 * the rich document when it is saved, that loses the formatting but not the words.
 *
 * The per-node guards below (unsupported node type, unusable latex, rejected href) are defense
 * in depth, not a second behaviour: the validator already rejects every one of those cases using
 * the same predicates, so a document that reaches the walker cannot contain them. They stay
 * because this walker is the last thing between stored data and the DOM, and because they would
 * become load-bearing if the schema were ever loosened. Do not document them as user-facing
 * behaviour, and do not assume a test that exercises them proves anything about real documents.
 */
/**
 * Validation results, keyed by the document object itself.
 *
 * Validation is a full Zod parse plus a structural walk, and it runs on every render. The
 * obvious `useMemo` is not available: this component is deliberately usable from a Server
 * Component (see RichDescription.server.test.tsx), and hooks are not. A WeakMap keyed on the
 * DTO's own object gives the same saving in both environments and holds nothing alive: when the
 * fetched data is replaced, its cache entry becomes collectable with it.
 *
 * Sound because the input is parsed JSON that nobody mutates in place. A refetch produces a new
 * object and therefore a fresh validation.
 */
const VALIDATION_CACHE = new WeakMap<object, ReturnType<typeof validateRichDescription>>();

function validateOnce(value: unknown): ReturnType<typeof validateRichDescription> {
  // WeakMap keys must be objects; anything else is cheap to reject anyway.
  if (typeof value !== 'object' || value === null) return validateRichDescription(value);
  const cached = VALIDATION_CACHE.get(value);
  if (cached) return cached;
  const result = validateRichDescription(value);
  VALIDATION_CACHE.set(value, result);
  return result;
}

export function RichDescription({
  description,
  descriptionJson,
  compact = false,
  className,
}: RichDescriptionProps) {
  const result = descriptionJson == null ? null : validateOnce(descriptionJson);
  const plain = <PlainDescription text={description} compact={compact} className={className} />;

  if (!result?.ok) {
    if (result) {
      warnFallback(`rich description failed validation (${result.error}); showing plain text`);
    }
    return plain;
  }

  const content = result.envelope.document.content ?? [];
  if (content.length === 0) return plain;

  // The boundary lives here rather than at each call site: the read surfaces are easy to add and
  // easy to forget (one was already shipped without rich rendering at all), so putting it in the
  // shared component is what makes the guarantee hold everywhere. It does not force the walker
  // onto the client: the children are rendered by whoever renders this, and only the boundary
  // itself is a client component.
  return (
    <RichDescriptionBoundary fallback={plain}>
      <div className={cn('afct-rich-text', compact && 'afct-rich-text--compact', className)}>
        {content.map((node, index) => (
          <React.Fragment key={index}>{renderNode(node, index)}</React.Fragment>
        ))}
      </div>
    </RichDescriptionBoundary>
  );
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
 * Everything a subtree contributes as text, used by both fallback levels. Math keeps the same
 * delimiters the plain-text projection uses ($ inline, $$ display) so a fallback reads the same
 * way the Java client sees it.
 */
function textOf(node: TiptapNode): string {
  if (node.type === 'text') return node.text ?? '';
  if (node.type === INLINE_MATH_NODE) return `$${String(node.attrs?.[MATH_LATEX_ATTR] ?? '')}$`;
  if (node.type === BLOCK_MATH_NODE) return `$$${String(node.attrs?.[MATH_LATEX_ATTR] ?? '')}$$`;
  return (node.content ?? []).map(textOf).join('');
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
function renderChildren(node: TiptapNode): React.ReactNode[] {
  return (node.content ?? []).map((child, index) => (
    <React.Fragment key={index}>{renderNode(child, index)}</React.Fragment>
  ));
}

function renderNode(node: TiptapNode, key: React.Key): React.ReactNode {
  switch (node.type) {
    case 'text':
      return renderText(node, key);

    case 'paragraph':
      return (
        <p key={key} data-align={alignOf(node)}>
          {renderChildren(node)}
        </p>
      );

    case 'heading': {
      // Clamped to the shared policy so a description can never introduce a competing page
      // heading, whatever an older or hand-crafted document claims.
      const raw =
        typeof node.attrs?.level === 'number' ? node.attrs.level : ALLOWED_HEADING_LEVELS[0];
      const level = (ALLOWED_HEADING_LEVELS as readonly number[]).includes(raw)
        ? raw
        : Math.min(Math.max(raw, ALLOWED_HEADING_LEVELS[0]), ALLOWED_HEADING_LEVELS.at(-1)!);
      const Tag = `h${level}` as 'h2' | 'h3' | 'h4';
      return (
        <Tag key={key} data-align={alignOf(node)}>
          {renderChildren(node)}
        </Tag>
      );
    }

    case 'bulletList':
      return <ul key={key}>{renderChildren(node)}</ul>;
    case 'orderedList':
      return <ol key={key}>{renderChildren(node)}</ol>;
    case 'listItem':
      return <li key={key}>{renderChildren(node)}</li>;
    case 'blockquote':
      return <blockquote key={key}>{renderChildren(node)}</blockquote>;
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

    default:
      // Unreachable for a validated document (the schema's node allowlist rejects the type
      // outright, so the whole document has already fallen back). Kept as a last resort so an
      // unknown wrapper degrades to its own text rather than disappearing.
      warnFallback(`rich description contains unsupported node "${node.type}"; rendering its text`);
      return <React.Fragment key={key}>{renderChildren(node)}</React.Fragment>;
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
      // Unreachable for a validated document: the schema runs isAllowedLinkHref, which shares
      // validateLinkUrl with describeLink, so the two cannot disagree. Kept as a last resort.
      const link = describeLink(mark.attrs?.href);
      if (!link) {
        warnFallback(
          'rich description contains a link with an unsupported href; rendering its text',
        );
        return <>{children}</>;
      }
      return (
        <a href={link.href} target={link.target} rel={link.rel}>
          {children}
        </a>
      );
    }
    default:
      return <>{children}</>;
  }
}

function renderMath(node: TiptapNode, key: React.Key): React.ReactNode {
  const latex = node.attrs?.[MATH_LATEX_ATTR];
  const displayMode = node.type === BLOCK_MATH_NODE;

  // Unreachable for a validated document: the schema applies this same isAllowedLatex check.
  // Kept as a last resort so a bad equation shows its source instead of breaking the render.
  if (!isAllowedLatex(latex)) {
    warnFallback('rich description contains an unusable equation; rendering its source');
    return <code key={key}>{String(latex ?? '')}</code>;
  }

  const html = renderDescriptionMath(latex as string, displayMode);
  if (html === null) return <code key={key}>{latex as string}</code>;

  const Tag = displayMode ? 'div' : 'span';
  return (
    <Tag
      key={key}
      data-type={displayMode ? 'block-math' : 'inline-math'}
      // The one dangerouslySetInnerHTML in this feature, and it is narrow: the input is a
      // schema-validated latex string bounded to MAX_LATEX_LENGTH, and KaTeX renders it with
      // trust: false, which refuses the commands that can emit markup or fetch resources
      // (\href, \url, \includegraphics, \html*). Nothing user-supplied reaches the DOM as HTML;
      // only KaTeX's own output does.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
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
