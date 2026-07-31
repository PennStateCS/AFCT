import type { RichDescriptionEnvelope, TiptapDocument } from './schema';

/**
 * Is this document the same as that one?
 *
 * Forms need to answer "has the author actually changed anything", and object identity cannot
 * answer it. Every render of the assignment page rebuilds the stored document through
 * `asRichDescription`, which runs a Zod parse and therefore hands back a NEW object with the same
 * contents; and Tiptap hands back a new document object on every keystroke, including the
 * keystroke that puts a word back the way it was. Comparing content is the only thing that
 * survives both.
 *
 * Key order is not meaningful here. Tiptap emits `{ type, attrs, content }` and our stored JSON
 * comes back from Zod in schema order, so two identical documents can serialize differently
 * through a plain JSON.stringify. Sorting keys first makes the comparison about the document.
 */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) sorted[key] = canonical(source[key]);
    return sorted;
  }
  return value;
}

/**
 * A stable string for a document, safe to use as a React dependency.
 *
 * Depending on the envelope object directly re-runs an effect on every render of the parent,
 * which is how a form's "the record changed, re-seed everything" effect ended up firing after
 * every edit and clearing the dirty flag.
 */
export function serializeRichDescription(
  value: RichDescriptionEnvelope | TiptapDocument | null | undefined,
): string {
  if (value == null) return '';
  const document = 'document' in value ? value.document : value;
  return JSON.stringify(canonical(document));
}
