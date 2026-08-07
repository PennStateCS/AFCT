import { z } from 'zod';
import { isAllowedLinkHref } from './link-url';
import { isAllowedLatex } from './latex';

/**
 * Rich-description storage format. This validates the versioned envelope we keep in
 * `descriptionJson`. It is deliberately server-safe: no React, no DOM, no Tiptap runtime,
 * just Zod over the plain Tiptap JSON shape. Anything the editor is allowed to produce must
 * be in the allowlists below; anything else fails validation and callers fall back to the
 * plain-text `description`.
 *
 * The node/mark names here must match the Tiptap extension config used by the editor. The
 * math node names are the one place that depends on a not-yet-installed extension
 * (@tiptap/extension-mathematics, wired in a later step) - keep them as the single source of
 * truth so a rename is one edit.
 */

export const RICH_DESCRIPTION_VERSION = 1 as const;

// Math nodes store their LaTeX source in this attribute. Confirm/adjust against the official
// Tiptap Mathematics extension when it is added.
export const INLINE_MATH_NODE = 'inlineMath';
export const BLOCK_MATH_NODE = 'blockMath';
export const MATH_LATEX_ATTR = 'latex';

export const ALLOWED_MARK_TYPES = ['bold', 'italic', 'underline', 'code', 'link'] as const;

// Every node type allowed inside document content (i.e. everything except the top-level doc).
export const ALLOWED_CONTENT_NODE_TYPES = [
  'paragraph',
  'text',
  'heading',
  'bulletList',
  'orderedList',
  'listItem',
  'blockquote',
  'horizontalRule',
  'hardBreak',
  'codeBlock',
  INLINE_MATH_NODE,
  BLOCK_MATH_NODE,
] as const;

// Supported alignments. 'justify' is intentionally absent.
export const ALLOWED_TEXT_ALIGN = ['left', 'center', 'right'] as const;

/**
 * Heading levels a description may contain. H1 belongs to the page, so a description that
 * carried one would compete with it in the heading outline; H5/H6 are not offered either. This
 * matches the editor's `heading: { levels: [2, 3, 4] }` exactly, so the two cannot drift.
 */
export const ALLOWED_HEADING_LEVELS = [2, 3, 4] as const;

/**
 * Structural bounds, checked after the shape parse. Zod validates what a node looks like; these
 * bound how much of it there can be, which is what stops a hand-crafted payload from turning a
 * render into a denial of service. Generous enough that no real description approaches them.
 */
export const MAX_DOCUMENT_DEPTH = 20;
export const MAX_NODE_COUNT = 5000;
/** Matches the 20000-character cap the plain-text `description` column already enforces. */
export const MAX_TEXT_NODE_LENGTH = 20000;

/** Attributes may only carry primitives; nested objects are never something the editor writes. */
function attrsArePrimitive(attrs: Record<string, unknown> | undefined): boolean {
  if (!attrs) return true;
  return Object.values(attrs).every(
    (value) =>
      value === null ||
      value === undefined ||
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean',
  );
}

export type TiptapMark = {
  type: (typeof ALLOWED_MARK_TYPES)[number];
  attrs?: Record<string, unknown>;
};

export type TiptapNode = {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: TiptapMark[];
  content?: TiptapNode[];
};

export type TiptapDocument = { type: 'doc'; content?: TiptapNode[] };

export type RichDescriptionEnvelope = {
  version: typeof RICH_DESCRIPTION_VERSION;
  document: TiptapDocument;
};

const markSchema = z
  .object({
    type: z.enum(ALLOWED_MARK_TYPES),
    attrs: z.record(z.string(), z.unknown()).optional(),
  })
  .superRefine((mark, ctx) => {
    if (mark.type === 'link') {
      const href = mark.attrs?.href;
      if (typeof href !== 'string' || href.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'link mark requires a non-empty href',
        });
      } else if (!isAllowedLinkHref(href)) {
        // Same allowlist the dialog enforces, applied to stored documents: a payload that
        // never went through the UI still cannot carry a javascript:/data:/http: href.
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'link href uses an unsupported protocol',
        });
      }
    }
  });

// Recursive: a node's content is more nodes. z.lazy + an explicit type keeps TS happy.
const nodeSchema: z.ZodType<TiptapNode> = z.lazy(() =>
  z
    .object({
      type: z.enum(ALLOWED_CONTENT_NODE_TYPES),
      text: z.string().optional(),
      attrs: z.record(z.string(), z.unknown()).optional(),
      marks: z.array(markSchema).optional(),
      content: z.array(nodeSchema).optional(),
    })
    .superRefine((node, ctx) => {
      if (node.type === 'text') {
        if (typeof node.text !== 'string') {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'text node requires text' });
        } else if (node.text.length > MAX_TEXT_NODE_LENGTH) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `text node exceeds ${MAX_TEXT_NODE_LENGTH} characters`,
          });
        }
      }
      if (!attrsArePrimitive(node.attrs)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'node attributes must be primitives',
        });
      }
      if (node.type === INLINE_MATH_NODE || node.type === BLOCK_MATH_NODE) {
        const latex = node.attrs?.[MATH_LATEX_ATTR];
        if (typeof latex !== 'string') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'math node requires a latex attribute',
          });
        } else if (!isAllowedLatex(latex)) {
          // Same bound the dialog enforces, applied to stored documents so an oversized or
          // empty equation cannot arrive by any other path.
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'math node latex is empty or too long',
          });
        }
      }
      if (node.type === 'heading') {
        const level = node.attrs?.level;
        if (level !== undefined && !ALLOWED_HEADING_LEVELS.includes(level as never)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `heading level must be one of ${ALLOWED_HEADING_LEVELS.join(', ')}`,
          });
        }
      }
      const align = node.attrs?.textAlign;
      if (align !== undefined && align !== null && !ALLOWED_TEXT_ALIGN.includes(align as never)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `unsupported text alignment: ${String(align)}`,
        });
      }
    }),
);

const documentSchema = z.object({
  type: z.literal('doc'),
  content: z.array(nodeSchema).optional(),
});

export const richDescriptionEnvelopeSchema = z.object({
  version: z.literal(RICH_DESCRIPTION_VERSION),
  document: documentSchema,
});

export type ValidateResult =
  { ok: true; envelope: RichDescriptionEnvelope } | { ok: false; error: string };

/**
 * The RENDER-TIME schema, deliberately more permissive than the write-time one above.
 *
 * Writes stay strict: `nodeSchema` rejects a document outright if it carries an unknown node,
 * an unsafe href, or unusable latex, so nothing of that shape can be stored through AFCT.
 *
 * Reads cannot afford the same answer. A document written by a NEWER AFCT will contain node
 * types this build has never heard of, and failing the whole envelope would drop an entire
 * assignment prompt to plain text over one unrecognised wrapper. So rendering parses for
 * STRUCTURE only (shape, primitive attributes, text size) and leaves every safety decision to
 * the walker, which drops the offending node or mark and keeps its siblings.
 *
 * The safety rules do not weaken, they move. `RichDescription` re-checks each href through
 * `isAllowedLinkHref`, each equation through `isAllowedLatex`, each heading level and alignment
 * against the shared allowlists, and renders nothing it does not recognise as an element. What
 * changes is the blast radius of a single bad node, not what is allowed to reach the DOM.
 */
const structuralMarkSchema: z.ZodType<TiptapMark> = z.lazy(
  () =>
    z.object({
      // Any string: an unknown mark is unwrapped by the walker rather than failing the document.
      type: z.string().min(1),
      attrs: z.record(z.string(), z.unknown()).optional(),
    }) as unknown as z.ZodType<TiptapMark>,
);

const structuralNodeSchema: z.ZodType<TiptapNode> = z.lazy(() =>
  z
    .object({
      type: z.string().min(1),
      text: z.string().optional(),
      attrs: z.record(z.string(), z.unknown()).optional(),
      marks: z.array(structuralMarkSchema).optional(),
      content: z.array(structuralNodeSchema).optional(),
    })
    .superRefine((node, ctx) => {
      // Kept even in the lenient parse: these bound how much work a render can be made to do,
      // which is a property of the renderer rather than of any one node's meaning.
      if (typeof node.text === 'string' && node.text.length > MAX_TEXT_NODE_LENGTH) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `text node exceeds ${MAX_TEXT_NODE_LENGTH} characters`,
        });
      }
      if (!attrsArePrimitive(node.attrs)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'node attributes must be primitives',
        });
      }
    }),
);

const structuralDocumentSchema = z.object({
  type: z.literal('doc'),
  content: z.array(structuralNodeSchema).optional(),
});

const structuralEnvelopeSchema = z.object({
  version: z.literal(RICH_DESCRIPTION_VERSION),
  document: structuralDocumentSchema,
});

/**
 * Walk the parsed document to enforce the bounds Zod cannot express: how deep it nests and how
 * many nodes it holds. Returns an error message, or null when the document is within bounds.
 */
function checkStructuralLimits(document: TiptapDocument): string | null {
  let count = 0;
  const visit = (nodes: TiptapNode[], depth: number): string | null => {
    if (depth > MAX_DOCUMENT_DEPTH)
      return `document nests deeper than ${MAX_DOCUMENT_DEPTH} levels`;
    for (const node of nodes) {
      if (++count > MAX_NODE_COUNT) return `document holds more than ${MAX_NODE_COUNT} nodes`;
      const failure = visit(node.content ?? [], depth + 1);
      if (failure) return failure;
    }
    return null;
  };
  return visit(document.content ?? [], 1);
}

/**
 * Bound the RAW value before Zod ever sees it.
 *
 * `checkStructuralLimits` runs on the parsed document, which is too late: `nodeSchema` is
 * recursive (`z.lazy`), so a deeply nested payload exhausts the JavaScript stack inside
 * `safeParse`. The resulting RangeError is not a ZodError, so `safeParse` does not turn it into
 * a failure, it propagates: a 500 on the write path, and a thrown render on a read surface.
 * Measuring depth here, iteratively and with an explicit stack, keeps an over-deep document an
 * ordinary validation failure.
 *
 * The node budget is applied in the same pass. That bounds the walk itself (so a cyclic object,
 * which JSON from the database cannot be but an in-memory caller could pass, cannot spin here)
 * and short-circuits an oversized payload before the expensive parse.
 */
function rawShapeExceedsLimits(value: unknown): string | null {
  const document = (value as { document?: unknown } | null | undefined)?.document;
  const stack: Array<[unknown, number]> = [];
  let count = 0;

  const pushChildren = (container: unknown, depth: number): void => {
    const content = (container as { content?: unknown } | null | undefined)?.content;
    if (Array.isArray(content)) for (const child of content) stack.push([child, depth]);
  };

  // Mirrors checkStructuralLimits: top-level nodes sit at depth 1, their children at depth 2.
  pushChildren(document, 1);
  while (stack.length > 0) {
    const [node, depth] = stack.pop()!;
    if (depth > MAX_DOCUMENT_DEPTH)
      return `document nests deeper than ${MAX_DOCUMENT_DEPTH} levels`;
    if (++count > MAX_NODE_COUNT) return `document holds more than ${MAX_NODE_COUNT} nodes`;
    if (node && typeof node === 'object') pushChildren(node, depth + 1);
  }
  return null;
}

/**
 * Validate an unknown value as a supported versioned rich-description envelope.
 *
 * Total: this returns a result for any input and never throws, because both callers need that.
 * The write path must reject junk with a 400 rather than a 500, and the read surfaces call it
 * during render, where a throw would blank the page instead of falling back to plain text.
 */
export function validateRichDescription(value: unknown): ValidateResult {
  return parseEnvelope(value, richDescriptionEnvelopeSchema);
}

/**
 * Parse a stored document for RENDERING, tolerating anything the walker can degrade safely.
 *
 * Whole-document rejection is reserved for the cases where there is genuinely nothing to show:
 * a missing or malformed envelope, an unsupported `version`, a root that is not a `doc`, or a
 * document past the depth, node-count, or text-size limits. Everything else, including node and
 * mark types this build does not know, is handed to the walker, which renders what it
 * recognises and degrades the rest.
 *
 * Use `validateRichDescription` for writes. Using this one there would let an unknown node be
 * stored, which is exactly what the strict schema exists to prevent.
 */
export function parseRichDescriptionForRender(value: unknown): ValidateResult {
  return parseEnvelope(value, structuralEnvelopeSchema);
}

/** Shared body of both parsers: raw bounds, then the given schema, then the parsed bounds. */
function parseEnvelope(
  value: unknown,
  schema: typeof richDescriptionEnvelopeSchema | typeof structuralEnvelopeSchema,
): ValidateResult {
  const oversized = rawShapeExceedsLimits(value);
  if (oversized) return { ok: false, error: oversized };

  let parsed: ReturnType<typeof schema.safeParse>;
  try {
    parsed = schema.safeParse(value);
  } catch {
    // The depth guard above is the known way to get here. Anything else that makes the parser
    // itself fail is still a bad document, not an operational error, so it takes the same path.
    return { ok: false, error: 'invalid rich description' };
  }
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid rich description' };
  }

  const envelope = parsed.data as RichDescriptionEnvelope;
  const structural = checkStructuralLimits(envelope.document);
  if (structural) return { ok: false, error: structural };
  return { ok: true, envelope };
}
