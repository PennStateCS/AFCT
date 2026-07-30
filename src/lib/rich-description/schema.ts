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

export type TiptapMark = { type: (typeof ALLOWED_MARK_TYPES)[number]; attrs?: Record<string, unknown> };

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
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'link mark requires a non-empty href' });
      } else if (!isAllowedLinkHref(href)) {
        // Same allowlist the dialog enforces, applied to stored documents: a payload that
        // never went through the UI still cannot carry a javascript:/data:/http: href.
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'link href uses an unsupported protocol' });
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
      if (node.type === 'text' && typeof node.text !== 'string') {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'text node requires text' });
      }
      if (node.type === INLINE_MATH_NODE || node.type === BLOCK_MATH_NODE) {
        const latex = node.attrs?.[MATH_LATEX_ATTR];
        if (typeof latex !== 'string') {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'math node requires a latex attribute' });
        } else if (!isAllowedLatex(latex)) {
          // Same bound the dialog enforces, applied to stored documents so an oversized or
          // empty equation cannot arrive by any other path.
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'math node latex is empty or too long' });
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
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `unsupported text alignment: ${String(align)}` });
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
  | { ok: true; envelope: RichDescriptionEnvelope }
  | { ok: false; error: string };

/** Validate an unknown value as a supported versioned rich-description envelope. */
export function validateRichDescription(value: unknown): ValidateResult {
  const parsed = richDescriptionEnvelopeSchema.safeParse(value);
  if (parsed.success) {
    return { ok: true, envelope: parsed.data as RichDescriptionEnvelope };
  }
  return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid rich description' };
}
