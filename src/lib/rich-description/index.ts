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
export { plainTextToRichDescription, richDescriptionToPlainText } from './plain-text';
export {
  resolveDescription,
  asRichDescription,
  type DescriptionRecord,
  type ResolvedDescription,
} from './resolve';
export {
  buildDescriptionWrite,
  InvalidRichDescriptionError,
  type DescriptionWriteInput,
  type DescriptionWriteFields,
} from './write';

export {
  KATEX_SHARED_OPTIONS,
  KATEX_PUBLISHED_OPTIONS,
  KATEX_VALIDATION_OPTIONS,
} from './katex-options';
export { parseLatexSource, isParsableLatex } from './latex-parse';
