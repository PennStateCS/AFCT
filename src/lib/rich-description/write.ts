import {
  validateRichDescription,
  BLOCK_MATH_NODE,
  INLINE_MATH_NODE,
  MATH_LATEX_ATTR,
  type RichDescriptionEnvelope,
  type TiptapNode,
} from './schema';
import { parseLatexSource } from './latex-parse';
import { richDescriptionToPlainText } from './plain-text';

export type DescriptionWriteInput = {
  description?: string | null;
  descriptionJson?: unknown;
};

export type DescriptionWriteFields = {
  description: string | null;
  descriptionFormat: 'PLAIN_TEXT' | 'TIPTAP_JSON';
  descriptionJson: RichDescriptionEnvelope | null;
};

export class InvalidRichDescriptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidRichDescriptionError';
  }
}

/**
 * Compute the three description columns from a write input so the rich JSON and the plain-text
 * `description` can never drift apart.
 *
 * - Rich JSON present: validate it, store it, and DERIVE `description` from it. Any separately
 *   supplied plain text is ignored (the JSON is authoritative).
 * - No rich JSON: it's a plain-text write - keep the plain text and clear `descriptionJson`.
 *
 * Throws InvalidRichDescriptionError on malformed rich JSON so a caller can never overwrite a
 * good description with junk. (API routes validate the envelope in their Zod schema first, so
 * they return 400 before reaching here; the throw is defense for any other caller.)
 */
/**
 * Every equation in the document, checked against KaTeX itself.
 *
 * The schema's `isAllowedLatex` is a source POLICY: non-empty and within the length cap. It
 * cannot tell `\frac{1}{2}` from `\frac{1}`, because deciding that means parsing. So a
 * hand-crafted request could store LaTeX the editor would never have let a professor save, and
 * the first person to find out would be a student looking at red error text in an assignment
 * prompt.
 *
 * This runs on the write path only. Reads deliberately do not re-parse: a stored equation that
 * has somehow become unrenderable degrades to its source on the page rather than costing a
 * KaTeX parse per equation per render.
 */
function firstUnparsableEquation(
  document: TiptapNode | RichDescriptionEnvelope['document'],
): string | null {
  const visit = (node: TiptapNode): string | null => {
    if (node.type === INLINE_MATH_NODE || node.type === BLOCK_MATH_NODE) {
      const latex = node.attrs?.[MATH_LATEX_ATTR];
      // Validate in the mode the node renders in: display-only constructs (`\begin{align}`,
      // `\tag`) throw when parsed as inline, which made them unsavable in a block equation.
      const parsed = parseLatexSource(typeof latex === 'string' ? latex : '', {
        displayMode: node.type === BLOCK_MATH_NODE,
      });
      if (!parsed.ok) return parsed.error;
    }
    for (const child of node.content ?? []) {
      const failure = visit(child);
      if (failure) return failure;
    }
    return null;
  };
  for (const node of document.content ?? []) {
    const failure = visit(node);
    if (failure) return failure;
  }
  return null;
}

export function buildDescriptionWrite(input: DescriptionWriteInput): DescriptionWriteFields {
  if (input.descriptionJson != null) {
    const result = validateRichDescription(input.descriptionJson);
    if (!result.ok) throw new InvalidRichDescriptionError(result.error);

    const badEquation = firstUnparsableEquation(result.envelope.document);
    if (badEquation) {
      throw new InvalidRichDescriptionError(`equation cannot be rendered: ${badEquation}`);
    }
    return {
      description: richDescriptionToPlainText(result.envelope),
      descriptionFormat: 'TIPTAP_JSON',
      descriptionJson: result.envelope,
    };
  }
  return {
    description: input.description ?? null,
    descriptionFormat: 'PLAIN_TEXT',
    descriptionJson: null,
  };
}
