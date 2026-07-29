export {
  RICH_DESCRIPTION_VERSION,
  INLINE_MATH_NODE,
  BLOCK_MATH_NODE,
  MATH_LATEX_ATTR,
  ALLOWED_MARK_TYPES,
  ALLOWED_CONTENT_NODE_TYPES,
  ALLOWED_TEXT_ALIGN,
  richDescriptionEnvelopeSchema,
  validateRichDescription,
  type TiptapMark,
  type TiptapNode,
  type TiptapDocument,
  type RichDescriptionEnvelope,
  type ValidateResult,
} from './schema';
export { plainTextToRichDescription, richDescriptionToPlainText } from './plain-text';
export { resolveDescription, type DescriptionRecord, type ResolvedDescription } from './resolve';
