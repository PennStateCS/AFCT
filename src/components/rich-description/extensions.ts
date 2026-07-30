import StarterKit from '@tiptap/starter-kit';
import TextAlign from '@tiptap/extension-text-align';
import Link from '@tiptap/extension-link';
import { ALLOWED_TEXT_ALIGN, ALLOWED_LINK_PROTOCOLS, isAllowedLinkHref } from '@/lib/rich-description';

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
 * Mathematics and expanded mode arrive in later steps.
 */
export const richDescriptionExtensions = [
  StarterKit.configure({
    strike: false,
    // Link is configured separately below with the AFCT protocol allowlist.
    link: false,
    // Headings below H1 only: the page already owns the H1.
    heading: { levels: [2, 3, 4] },
  }),
  // Links are created only through the toolbar dialog, which validates the URL. This config
  // is the second line of defence:
  //  - protocols/isAllowedUri restrict schemes to the shared allowlist (https, mailto), so
  //    even a paste or an autolink cannot introduce javascript:/data:/http:.
  //  - autolink is off: a faculty member types the URL into the dialog, so nothing is
  //    silently linkified from arbitrary typed text.
  //  - openOnClick is off so clicking a link while editing places the caret instead of
  //    navigating away mid-edit.
  Link.configure({
    autolink: false,
    openOnClick: false,
    linkOnPaste: false,
    protocols: ALLOWED_LINK_PROTOCOLS.map((p) => p.replace(':', '')),
    isAllowedUri: (url: string) => isAllowedLinkHref(url),
    HTMLAttributes: {
      // Rendered links are safe by construction: no window.opener handle, and no referrer
      // leakage to the destination.
      rel: 'noopener noreferrer nofollow',
      target: '_blank',
    },
  }),
  // Alignment on paragraphs and headings only. `alignments` is the allowlist the extension
  // itself enforces, and it comes from the same constant the validator uses, so `justify`
  // cannot be produced here or accepted on read. Left is the default and is stored as no
  // attribute at all, keeping existing documents unchanged.
  //
  // The upstream extension renders alignment as an inline `style="text-align: …"`. AFCT
  // renders a `data-align` attribute instead (styled by .afct-rich-text in globals.css), so
  // rendered output carries no inline style for a sanitizer to have to reason about. Parsing
  // still accepts the upstream inline style, so pasted/older content keeps working.
  TextAlign.extend({
    addAttributes() {
      return {
        textAlign: {
          default: null,
          parseHTML: (element: HTMLElement) => {
            const value = element.getAttribute('data-align') ?? element.style.textAlign;
            return ALLOWED_TEXT_ALIGN.includes(value as never) ? value : null;
          },
          renderHTML: (attributes: Record<string, unknown>) => {
            const value = attributes.textAlign as string | null;
            if (!value || value === 'left' || !ALLOWED_TEXT_ALIGN.includes(value as never)) {
              return {};
            }
            return { 'data-align': value };
          },
        },
      };
    },
  }).configure({
    types: ['paragraph', 'heading'],
    alignments: [...ALLOWED_TEXT_ALIGN],
    // No defaultAlignment on purpose: with one set, every block would carry an explicit
    // textAlign: 'left'. Leaving it unset keeps left as "no attribute", so plain paragraphs
    // and every pre-existing document stay byte-identical.
  }),
];
