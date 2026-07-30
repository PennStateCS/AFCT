import StarterKit from '@tiptap/starter-kit';

/**
 * The Tiptap extension set for AFCT rich descriptions.
 *
 * This MUST stay in step with the allowlist the validator enforces
 * (`ALLOWED_CONTENT_NODE_TYPES` / `ALLOWED_MARK_TYPES` in `@/lib/rich-description`): an
 * extension enabled here but missing there produces documents that fail validation and
 * silently fall back to plain text.
 *
 * Deliberately disabled:
 *  - strike: not in the supported feature set.
 *  - link: added in its own step with a safe-protocol dialog, not as free-form input.
 * Alignment, mathematics, and expanded mode arrive in later steps.
 */
export const richDescriptionExtensions = [
  StarterKit.configure({
    strike: false,
    link: false,
    // Headings below H1 only: the page already owns the H1.
    heading: { levels: [2, 3, 4] },
  }),
];
