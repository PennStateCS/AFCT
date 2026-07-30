import { validateRichDescription, type RichDescriptionEnvelope } from './schema';
import { richDescriptionToPlainText } from './plain-text';

// The description-bearing fields of an Assignment/Problem row. Kept as a local shape so this
// util stays decoupled from the generated Prisma types.
export type DescriptionRecord = {
  description: string | null;
  descriptionFormat: 'PLAIN_TEXT' | 'TIPTAP_JSON';
  descriptionJson: unknown;
};

export type ResolvedDescription =
  | { format: 'TIPTAP_JSON'; envelope: RichDescriptionEnvelope; plainText: string }
  | { format: 'PLAIN_TEXT'; plainText: string };

/**
 * Resolve a record into a safe description representation. Returns the validated rich document
 * (plus derived plain text) only when the stored JSON is a supported envelope; otherwise falls
 * back to the plain-text `description`. Fallback covers missing JSON, malformed JSON, an
 * unsupported version, and unsupported document structures.
 */
export function resolveDescription(record: DescriptionRecord): ResolvedDescription {
  if (record.descriptionFormat === 'TIPTAP_JSON' && record.descriptionJson != null) {
    const result = validateRichDescription(record.descriptionJson);
    if (result.ok) {
      return {
        format: 'TIPTAP_JSON',
        envelope: result.envelope,
        plainText: richDescriptionToPlainText(result.envelope),
      };
    }
    // malformed / unsupported -> fall through to the stored plain text
  }
  return { format: 'PLAIN_TEXT', plainText: record.description ?? '' };
}

/**
 * Narrow an unknown `descriptionJson` (straight off a DTO) to a supported envelope, or null.
 *
 * For UI callers that hold only the JSON field and want to seed an editor or renderer with it:
 * anything unsupported becomes null so the caller falls back to the plain text.
 */
export function asRichDescription(value: unknown): RichDescriptionEnvelope | null {
  if (value == null) return null;
  const result = validateRichDescription(value);
  return result.ok ? result.envelope : null;
}
