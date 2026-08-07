export {
  RICH_DESCRIPTION_VERSION,
  INLINE_MATH_NODE,
  BLOCK_MATH_NODE,
  MATH_LATEX_ATTR,
  ALLOWED_MARK_TYPES,
  ALLOWED_CONTENT_NODE_TYPES,
  ALLOWED_TEXT_ALIGN,
  ALLOWED_HEADING_LEVELS,
  MAX_DOCUMENT_DEPTH,
  MAX_NODE_COUNT,
  MAX_TEXT_NODE_LENGTH,
  richDescriptionEnvelopeSchema,
  validateRichDescription,
  parseRichDescriptionForRender,
  type TiptapMark,
  type TiptapNode,
  type TiptapDocument,
  type RichDescriptionEnvelope,
  type ValidateResult,
} from './schema';
export {
  ALLOWED_LINK_PROTOCOLS,
  validateLinkUrl,
  isAllowedLinkHref,
  describeLink,
  type LinkUrlResult,
  type LinkPresentation,
} from './link-url';
export { MAX_LATEX_LENGTH, validateLatex, isAllowedLatex, type LatexResult } from './latex';
export { serializeRichDescription } from './compare';
export { plainTextToRichDescription, richDescriptionToPlainText } from './plain-text';
export {
  resolveDescription,
  asRichDescription,
  type DescriptionRecord,
  type ResolvedDescription,
} from './resolve';
export {
  KATEX_SHARED_OPTIONS,
  KATEX_PUBLISHED_OPTIONS,
  KATEX_VALIDATION_OPTIONS,
} from './katex-options';

/**
 * `./latex-parse` and `./write` are deliberately NOT re-exported here.
 *
 * Both reach KaTeX (write.ts validates every equation through latex-parse), and this barrel is
 * imported by client components, so re-exporting them put a ~700 KB maths typesetter in the chunk
 * graph of every route that renders a description. Barrel re-exports are not tree-shaken here:
 * importing one name pulls the module.
 *
 * The two places that genuinely parse LaTeX import from '@/lib/rich-description/latex-parse' and
 * '@/lib/rich-description/write' directly. Everything in this file is free of KaTeX; keep it that
 * way, and check the built chunks rather than assuming when adding an export.
 */
