import { validateRichDescription, type RichDescriptionEnvelope } from './schema';
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
export function buildDescriptionWrite(input: DescriptionWriteInput): DescriptionWriteFields {
  if (input.descriptionJson != null) {
    const result = validateRichDescription(input.descriptionJson);
    if (!result.ok) throw new InvalidRichDescriptionError(result.error);
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
